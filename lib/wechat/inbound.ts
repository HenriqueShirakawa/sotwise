import "server-only";

import { createMessage, entityIdFromNumber } from "@/lib/messages";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MessageEntity } from "@/types/database";

import { profileIdFromEventKey } from "./bind";
import { wechatConfig, type WechatConfig } from "./client";
import { xmlField } from "./crypto";
import { shareInfoText } from "./profile-info";
import { deliverMessageToWechat, entityLabels, replyToWechatUser } from "./notify";
import { parseReply } from "./parse-reply";

/** Mesmo limite do compositor da tela (0/500). */
const MAX_BODY = 500;

const HOW_TO =
  'Start your reply with the record number: "1676 your text" (Order), "PL 1473 your text" or "SH 1473 your text" (Shipment).\n' +
  '请以单号开头回复:"1676 内容"(订单)、"PL 1473 内容" 或 "SH 1473 内容"(出货)。';

const NOT_LINKED =
  "Your WeChat is not linked to a SOT user. Open SOT → My profile → WeChat → Link WeChat and scan the code.\n" +
  "你的微信尚未关联 SOT 用户,请在 SOT「My profile」→ WeChat → Link WeChat 扫码绑定。";

/**
 * Para quem vai a resposta: o autor da última mensagem DESTE registro em que a
 * pessoa foi marcada; se não houver, o último autor da thread que não é ela;
 * se a thread estiver vazia, lista vazia → regra da tela (toda a equipe).
 */
async function replyRecipients(entityType: MessageEntity, entityId: string, userId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data: thread } = await admin
    .from("messages")
    .select("id, author_id")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .neq("author_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (!thread?.length) return [];

  const { data: tagged } = await admin
    .from("message_recipients")
    .select("message_id")
    .eq("user_id", userId)
    .in(
      "message_id",
      thread.map((t) => t.id)
    );
  const taggedIds = new Set((tagged ?? []).map((t) => t.message_id));
  const target = thread.find((t) => taggedIds.has(t.id)) ?? thread[0];
  return [target.author_id];
}

type LogRow = {
  status: string;
  profile_id?: string | null;
  message_id?: string | null;
  body?: string | null;
  error?: string | null;
};

/** Grava o OpenID no profile do QR escaneado e confirma pelo próprio WeChat. */
async function bindProfile(
  cfg: WechatConfig,
  openId: string,
  profileId: string,
  finish: (row: LogRow) => Promise<void>,
  origin?: string
): Promise<void> {
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, full_name, status, role_id")
    .eq("id", profileId)
    .maybeSingle();
  // Só a equipe interna (fase 1): o papel client não se vincula.
  const { data: role } = profile
    ? await admin.from("roles").select("name").eq("id", profile.role_id).maybeSingle()
    : { data: null };
  const roleName = role?.name;
  if (!profile || profile.status !== "active" || roleName === "client") {
    await finish({ status: "rejected", profile_id: profile?.id ?? null, error: "bind: profile not eligible" });
    await replyToWechatUser(cfg, openId, "This link code is not valid. Generate a new one in SOT → My profile.\n二维码无效,请在 SOT「My profile」重新生成。");
    return;
  }

  // Um WeChat responde por UM usuário: solta de quem tinha antes e prende neste.
  // Nome/foto são do WeChat, não do usuário: vão junto (se já autorizados).
  const { data: previous } = await admin
    .from("profiles")
    .select("wechat_nickname, wechat_avatar_url")
    .eq("wechat_openid", openId)
    .not("wechat_nickname", "is", null)
    .limit(1)
    .maybeSingle();
  await admin
    .from("profiles")
    .update({ wechat_openid: null, wechat_nickname: null, wechat_avatar_url: null })
    .eq("wechat_openid", openId)
    .neq("id", profile.id);
  const { error } = await admin
    .from("profiles")
    .update({
      wechat_openid: openId,
      wechat_nickname: previous?.wechat_nickname ?? null,
      wechat_avatar_url: previous?.wechat_avatar_url ?? null,
    })
    .eq("id", profile.id);
  if (error) {
    await finish({ status: "failed", profile_id: profile.id, error: `bind: ${error.message}` });
    await replyToWechatUser(cfg, openId, "Could not link (error). Try again.\n关联失败,请重试。");
    return;
  }

  await finish({ status: "accepted", profile_id: profile.id, error: null, body: "bind" });
  await replyToWechatUser(
    cfg,
    openId,
    `Linked to SOT as ${profile.full_name}. Messages you are tagged in will arrive here.\n${HOW_TO}\n\n` +
      `已关联 SOT 用户 ${profile.full_name}。`
  );
  // Nome e foto só vêm se a pessoa autorizar numa página do WeChat.
  const share = previous ? null : shareInfoText(cfg, origin);
  if (share) await replyToWechatUser(cfg, openId, share);
}

/**
 * Trata um callback já conferido (e decifrado, no modo seguro). Nunca lança;
 * tudo vira linha em `wechat_message_log`. Dedup pelo MsgId (eventos não têm:
 * usa remetente + hora + evento) — o WeChat reenvia o mesmo callback até 3x.
 */
export async function handleWechatInbound(xml: string, origin?: string): Promise<void> {
  const cfg = wechatConfig();
  if (!cfg) return;
  const admin = createAdminClient();

  const msgType = xmlField(xml, "MsgType");
  const event = xmlField(xml, "Event");
  const from = xmlField(xml, "FromUserName");
  if (!from) return;
  // Confirmação de entrega de template: só ruído.
  if (event === "TEMPLATESENDJOBFINISH") return;

  const isBind = msgType === "event" && (event === "subscribe" || event === "SCAN");
  const isText = msgType === "text";
  const content = isText ? (xmlField(xml, "Content") ?? "") : null;

  if (!isBind && !isText) {
    const { error } = await admin.from("wechat_message_log").insert({
      direction: "in",
      status: "ignored",
      wechat_openid: from,
      error: `MsgType=${msgType}${event ? ` Event=${event}` : ""}`,
    });
    if (error) console.error("[wechat] log falhou:", error.message);
    return;
  }

  // Reserva o id antes de qualquer efeito: se for repetido, para aqui.
  const dedupId = xmlField(xml, "MsgId") ?? `${from}:${xmlField(xml, "CreateTime")}:${event}`;
  const { data: claimed, error: claimError } = await admin
    .from("wechat_message_log")
    .insert({ direction: "in", status: "processing", wechat_openid: from, wechat_msgid: dedupId, body: content })
    .select("id")
    .single();
  if (claimError?.code === "23505") return;
  if (claimError) console.error("[wechat] log falhou:", claimError.message);
  const finish = async (row: LogRow) => {
    const write = claimed
      ? admin.from("wechat_message_log").update(row).eq("id", claimed.id)
      : admin.from("wechat_message_log").insert({ direction: "in", wechat_openid: from, ...row });
    const { error } = await write;
    if (error) console.error("[wechat] log falhou:", error.message);
  };

  if (isBind) {
    const profileId = profileIdFromEventKey(xmlField(xml, "EventKey"));
    if (profileId) return bindProfile(cfg, from, profileId, finish, origin);
    // Seguiu a conta sem QR de vínculo (busca, cartão...): só orienta.
    await finish({ status: "ignored", error: `Event=${event} without bind code` });
    await replyToWechatUser(cfg, from, NOT_LINKED);
    return;
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("id, company, status")
    .eq("wechat_openid", from)
    .maybeSingle();
  if (!profile || profile.status !== "active") {
    await finish({ status: "rejected", error: profile ? "user blocked" : "wechat not linked" });
    await replyToWechatUser(cfg, from, NOT_LINKED);
    return;
  }

  const parsed = parseReply(content ?? "");
  if (!parsed) {
    await finish({ status: "rejected", profile_id: profile.id, error: "no record number" });
    await replyToWechatUser(cfg, from, `Not posted. ${HOW_TO}`);
    return;
  }

  const { label } = entityLabels(parsed.type, parsed.number);
  const entityId = await entityIdFromNumber(parsed.type, parsed.number);
  if (!entityId) {
    await finish({ status: "rejected", profile_id: profile.id, error: `${label} not found` });
    await replyToWechatUser(cfg, from, `Not posted: ${label} not found.\n${HOW_TO}`);
    return;
  }

  // WYSIWYG: texto longo é recusado, não cortado em silêncio.
  if (parsed.body.length > MAX_BODY) {
    await finish({ status: "rejected", profile_id: profile.id, error: "too long" });
    await replyToWechatUser(
      cfg,
      from,
      `Not posted: message has ${parsed.body.length} characters, the limit is ${MAX_BODY}.`
    );
    return;
  }

  const created = await createMessage({
    entity_type: parsed.type,
    entity_id: entityId,
    author_id: profile.id,
    author_company: profile.company,
    body: parsed.body,
    recipient_ids: await replyRecipients(parsed.type, entityId, profile.id),
  });
  if (!created.ok) {
    await finish({ status: "failed", profile_id: profile.id, error: created.error });
    await replyToWechatUser(cfg, from, `Not posted (error). Try again or use SOT.`);
    return;
  }

  // Quem responde pelo WeChat leu a thread: zera as não lidas dele ali.
  const { data: threadIds } = await admin
    .from("messages")
    .select("id")
    .eq("entity_type", parsed.type)
    .eq("entity_id", entityId);
  if (threadIds?.length) {
    await admin
      .from("message_recipients")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", profile.id)
      .is("read_at", null)
      .in(
        "message_id",
        threadIds.map((t) => t.id)
      );
  }

  await finish({ status: "accepted", profile_id: profile.id, message_id: created.id, body: parsed.body });
  await Promise.all([
    replyToWechatUser(cfg, from, `Posted to ${label}.`),
    // A conversa continua no WeChat de quem recebeu a resposta.
    deliverMessageToWechat(created.id, origin),
  ]);
}
