import "server-only";

import { after } from "next/server";

import { loadEntityContext } from "@/lib/messages";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MessageEntity } from "@/types/database";

import {
  OUT_OF_WINDOW,
  sendCustomText,
  sendTemplate,
  wechatConfig,
  type WechatConfig,
  type WechatSendResult,
} from "./client";
import { parseTemplateFields, templateData } from "./template";

/** Como cada registro aparece no WeChat e como a resposta deve começar. */
export function entityLabels(type: MessageEntity, number: string) {
  if (type === "order") return { label: `Order ${number}`, prefix: number, path: `/orders/${encodeURIComponent(number)}` };
  if (type === "pre_loading") return { label: `PL ${number}`, prefix: `PL ${number}`, path: `/pre-loading/${encodeURIComponent(number)}` };
  return { label: `Shipment ${number}`, prefix: `SH ${number}`, path: `/shipments/${encodeURIComponent(number)}` };
}

/** Base dos links: env fixa (recomendado em prod) ou o origin da request. */
export function linkBase(origin?: string): string | undefined {
  return process.env.WECHAT_LINK_BASE_URL?.replace(/\/$/, "") || origin;
}

/**
 * Texto curto mandado de volta a quem escreveu (instrução, erro, ok). A pessoa
 * acabou de escrever, então está dentro da janela de 48h.
 */
export async function replyToWechatUser(cfg: WechatConfig, openId: string, content: string): Promise<void> {
  const res = await sendCustomText(cfg, openId, content);
  if (!res.ok) console.error("[wechat] resposta ao usuário falhou:", res.error);
}

/** Hora do aviso no template, no fuso da equipe da China (quem mais usa WeChat). */
function noticeTime(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/**
 * Manda a mensagem do SOT ao WeChat de cada destinatário vinculado. Nunca lança:
 * falha vai para `wechat_message_log` (status failed) e para o console.
 *
 * Por pessoa: primeiro o texto completo (mensagem de atendimento). Se ela está
 * fora da janela de 48h, cai para o aviso por template, quando configurado.
 */
export async function deliverMessageToWechat(messageId: string, origin?: string): Promise<void> {
  const cfg = wechatConfig();
  if (!cfg) return;
  const admin = createAdminClient();

  try {
    const { data: msg } = await admin
      .from("messages")
      .select("id, entity_type, entity_id, author_id, body")
      .eq("id", messageId)
      .maybeSingle();
    if (!msg) return;

    const { data: recipientRows } = await admin
      .from("message_recipients")
      .select("user_id")
      .eq("message_id", messageId);
    const recipientIds = (recipientRows ?? []).map((r) => r.user_id);
    if (!recipientIds.length) return;

    const { data: linked } = await admin
      .from("profiles")
      .select("id, wechat_openid")
      .in("id", recipientIds)
      .eq("status", "active")
      .not("wechat_openid", "is", null);
    const targets = (linked ?? []).filter((p): p is { id: string; wechat_openid: string } => !!p.wechat_openid);
    // Ninguém com WeChat vinculado: nada a fazer e nada a registrar.
    if (!targets.length) return;

    const [{ data: author }, context] = await Promise.all([
      admin.from("profiles").select("full_name").eq("id", msg.author_id).maybeSingle(),
      loadEntityContext(msg.entity_type, msg.entity_id),
    ]);
    const authorName = author?.full_name ?? "SOT";
    const number = context?.number ?? "—";
    const { label, prefix, path } = entityLabels(msg.entity_type, number);
    const clientName = context?.client?.slice(0, 80) ?? "";
    const base = linkBase(origin);
    const link = base ? `${base}${path}` : undefined;

    const content = [
      `${authorName} · ${label}${clientName ? ` (${clientName})` : ""}`,
      msg.body,
      "",
      `Reply starting with "${prefix} " · 回复请以 "${prefix} " 开头`,
      link ? `<a href="${link}">Open in SOT</a>` : null,
    ]
      .filter((line) => line !== null)
      .join("\n");

    const templateId = process.env.WECHAT_TEMPLATE_ID;
    const fields = parseTemplateFields(process.env.WECHAT_TEMPLATE_FIELDS);
    const data =
      templateId && fields
        ? templateData(fields, {
            author: authorName,
            record: label,
            client: clientName,
            body: msg.body,
            reply: `${prefix} …`,
            time: noticeTime(),
          })
        : null;

    const rows = await Promise.all(
      targets.map(async (t) => {
        let channel: "custom" | "template" = "custom";
        let res: WechatSendResult = await sendCustomText(cfg, t.wechat_openid, content);
        if (!res.ok && res.errcode !== null && OUT_OF_WINDOW.has(res.errcode) && templateId && data) {
          channel = "template";
          res = await sendTemplate(cfg, t.wechat_openid, templateId, link, data);
        }
        if (!res.ok) console.error(`[wechat] envio a ${t.id} falhou:`, res.error);
        return {
          direction: "out" as const,
          status: res.ok ? "sent" : "failed",
          channel,
          wechat_openid: t.wechat_openid,
          profile_id: t.id,
          message_id: msg.id,
          wechat_msgid: res.ok ? res.msgid : null,
          body: msg.body,
          error: res.ok ? null : res.error,
        };
      })
    );

    const { error } = await admin.from("wechat_message_log").insert(rows);
    if (error) console.error("[wechat] log falhou:", error.message);
  } catch (error) {
    console.error("[wechat] envio falhou:", error);
  }
}

/** Agenda a entrega para DEPOIS da resposta — quem grava nunca espera o WeChat. */
export function notifyMessageViaWechat(messageId: string, origin?: string): void {
  if (!wechatConfig()) return;
  try {
    after(() => deliverMessageToWechat(messageId, origin));
  } catch {
    // Fora de um ciclo de request (script): entrega na hora, sem bloquear.
    void deliverMessageToWechat(messageId, origin);
  }
}
