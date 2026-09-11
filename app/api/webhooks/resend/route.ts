import type { NextRequest } from "next/server";

import { fetchReceivedEmail } from "@/lib/email/resend";
import { verifyResendWebhook } from "@/lib/email/verify-resend-webhook";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EmailReplyAttribution, StepEmailRecipient } from "@/types/database";

/**
 * Webhook do Resend — evento `email.received` (recebimento de e-mail no
 * domínio de recebimento, ver docs/regras_de_negocio.md §checklist emails).
 * Server-to-server, sem sessão de usuário: a autorização é a assinatura Svix
 * do próprio Resend (`RESEND_WEBHOOK_SECRET`), não um bearer secret como os
 * outros webhooks inbound do projeto (GSS) — o Resend não permite escolher
 * esse mecanismo, então este endpoint é o único do app que verifica HMAC de
 * corpo em vez de comparar um token estático.
 *
 * Hoje o único uso é resposta do cliente ao "e-mail manual por etapa"
 * (`checklist_step_emails` / `lib/checklist-email-actions.ts`). O token do
 * Reply-To (`reply+<uuid>@<domínio>`) tem dois formatos, resolvidos nesta ordem:
 *  1. id de `email_threads` (Fase 2 do threading, todo envio novo): a
 *     resposta pertence à CONVERSA do pedido; a etapa exata sai do
 *     `In-Reply-To`/`References` do e-mail recebido, casado contra o
 *     `message_id` de cada linha da thread (`attribution = 'message_id'`).
 *     Sem cabeçalho que bata (forward, cliente que descarta), cai na linha
 *     mais recente da thread, marcada `'fallback'` — a tela avisa.
 *  2. id de `checklist_step_emails` (envios de antes da Fase 2): a própria
 *     linha, sem ambiguidade (`'direct'`).
 *
 * Payload do evento só traz METADADOS (from/to/subject/message_id) — o corpo
 * exige uma segunda chamada (`fetchReceivedEmail`, `GET /emails/receiving/:id`).
 */

export const dynamic = "force-dynamic";

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

const REPLY_TOKEN_RE = /^reply\+([0-9a-f-]{36})@/i;

type ResendReceivedPayload = {
  type: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    subject?: string;
  };
};

/** "Nome" <email> ou só email — devolve os dois pedaços, nome ausente vira null. */
function parseFromHeader(raw: string): { email: string; name: string | null } {
  const match = raw.match(/^"?([^"<]*?)"?\s*<([^>]+)>$/);
  if (match) {
    const name = match[1].trim();
    return { email: match[2].trim(), name: name || null };
  }
  return { email: raw.trim(), name: null };
}

/** Fallback quando o Resend não manda `text` — nunca guardamos só HTML como
 *  única fonte de exibição (a UI não renderiza HTML de e-mail externo cru). */
function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/tr)\s*\/?>(?![\s\S]*<\/(html|body)>)/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Marcadores de citação do e-mail original que os clientes de e-mail mais
 * usados prependem numa resposta top-posted (Gmail en/pt-BR, Outlook, Apple
 * Mail) — cortamos tudo a partir do primeiro que aparecer, sobra só o que a
 * pessoa escreveu de fato. É uma heurística (não um parser RFC completo),
 * mas cobre o caso comum sem puxar uma dependência só pra isso.
 */
const QUOTE_MARKERS: RegExp[] = [
  /^>.*$/m, // linha já citada (prefixo ">")
  // `[\s\S]` em vez de `.`: quando o cabeçalho da citação fica longo, o
  // Gmail quebra a linha antes de "escreveu:"/"wrote:" — com `.` o padrão
  // não casava e a citação inteira sobrava no corpo salvo (visto numa
  // resposta de verdade em 11/09/2026).
  /^On\s[\s\S]{0,300}?\bwrote:\s*$/m, // Gmail/Apple Mail (inglês)
  /^Em\s[\s\S]{0,300}?\bescreveu:\s*$/im, // Gmail (pt-BR)
  /^-{2,}\s*(Original Message|Mensagem original)\s*-{2,}$/im,
  /^_{5,}$/m, // separador do Outlook antes do bloco From:/Sent:/To:
];

function stripQuotedReply(text: string): string {
  let cutAt = text.length;
  for (const marker of QUOTE_MARKERS) {
    const match = marker.exec(text);
    if (match && match.index < cutAt) cutAt = match.index;
  }
  const stripped = text.slice(0, cutAt).trim();
  // Se a heurística cortou tudo (falso positivo), preserva o texto original
  // em vez de guardar uma resposta vazia.
  return stripped || text.trim();
}

type ParentEmail = { id: string; sender_id: string; recipients: StepEmailRecipient[] };

/** Todos os Message-IDs citados nos cabeçalhos de threading do e-mail
 *  recebido — `In-Reply-To` primeiro (o que a pessoa respondeu de fato),
 *  depois `References` (a cadeia inteira, do mais recente pro mais antigo),
 *  pra cobrir cliente de e-mail que preenche um mas não o outro. */
function referencedMessageIds(headers: Record<string, string>): string[] {
  const get = (name: string) =>
    headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()] ?? "";
  const inReplyTo = get("In-Reply-To").match(/<[^>]+>/g) ?? [];
  const references = (get("References").match(/<[^>]+>/g) ?? []).reverse();
  return [...new Set([...inReplyTo, ...references])];
}

/**
 * Resolve o token do Reply-To pra linha de `checklist_step_emails` que a
 * resposta pertence (ver comentário do módulo). Thread primeiro: é o formato
 * de todo envio novo. `null` = token não é nem thread nem linha — ignorar.
 */
async function resolveParentEmail(
  admin: ReturnType<typeof createAdminClient>,
  token: string,
  headers: Record<string, string>
): Promise<{ parent: ParentEmail; attribution: EmailReplyAttribution } | null> {
  const { data: thread } = await admin.from("email_threads").select("id").eq("id", token).maybeSingle();

  if (!thread) {
    const { data: direct } = await admin
      .from("checklist_step_emails")
      .select("id, sender_id, recipients")
      .eq("id", token)
      .maybeSingle();
    return direct ? { parent: direct as ParentEmail, attribution: "direct" } : null;
  }

  const { data: rows } = await admin
    .from("checklist_step_emails")
    .select("id, sender_id, recipients, message_id, created_at")
    .eq("thread_id", thread.id)
    .order("created_at", { ascending: false });
  if (!rows?.length) return null;

  // Cada destinatário recebeu uma mensagem com Message-ID próprio; a linha
  // guarda o primeiro em `message_id` e todos em `recipients[].message_id`.
  const cited = referencedMessageIds(headers);
  for (const messageId of cited) {
    const hit = rows.find(
      (r) =>
        r.message_id === messageId ||
        (r.recipients as StepEmailRecipient[]).some((rc) => rc.message_id === messageId)
    );
    if (hit) return { parent: hit as ParentEmail, attribution: "message_id" };
  }

  // Sem cabeçalho que bata: a linha mais recente da thread é o melhor chute —
  // marcado como tal, nunca apresentado como certeza.
  return { parent: rows[0] as ParentEmail, attribution: "fallback" };
}

export async function POST(request: NextRequest): Promise<Response> {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return json({ error: "RESEND_WEBHOOK_SECRET not configured." }, 503);

  const rawBody = await request.text();
  const verified = verifyResendWebhook({
    rawBody,
    svixId: request.headers.get("svix-id"),
    svixTimestamp: request.headers.get("svix-timestamp"),
    svixSignature: request.headers.get("svix-signature"),
    secret,
  });
  if (!verified.ok) return json({ error: verified.reason }, 401);

  let payload: ResendReceivedPayload | null = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  if (!payload || payload.type !== "email.received" || !payload.data?.email_id) {
    return json({ ignored: true }, 200);
  }
  const { email_id: emailId, from, to, subject } = payload.data;

  const token = (to ?? []).map((addr) => addr.match(REPLY_TOKEN_RE)?.[1]).find(Boolean);
  if (!token || !from) return json({ ignored: true }, 200);

  const admin = createAdminClient();

  // Idempotência: retry do Resend pro mesmo email_id não duplica a resposta
  // nem o fan-out de notificação.
  const { data: existingReply } = await admin
    .from("checklist_step_email_replies")
    .select("id")
    .eq("provider_message_id", emailId)
    .maybeSingle();
  if (existingReply) return json({ ok: true, duplicate: true }, 200);

  const received = await fetchReceivedEmail(emailId);
  if (!received.ok) {
    // 500 -> o Resend tenta de novo; não gravamos nada pela metade.
    return json({ error: received.error }, 500);
  }

  const resolved = await resolveParentEmail(admin, token, received.email.headers);
  if (!resolved) return json({ ignored: true }, 200);
  const { parent, attribution } = resolved;

  const rawFrom = received.email.headers["From"] ?? received.email.headers["from"] ?? from;
  const parsedFrom = parseFromHeader(rawFrom);
  const rawBodyText =
    received.email.text?.trim() ||
    (received.email.html ? htmlToText(received.email.html) : "") ||
    "(no content)";
  const bodyText = stripQuotedReply(rawBodyText);

  const recipients = parent.recipients as StepEmailRecipient[];
  const matched = recipients.find((r) => r.email.toLowerCase() === parsedFrom.email.toLowerCase());

  const { data: inserted, error: insertError } = await admin
    .from("checklist_step_email_replies")
    .insert({
      checklist_step_email_id: parent.id,
      from_email: parsedFrom.email,
      from_name: matched?.name ?? parsedFrom.name,
      from_user_id: matched?.user_id ?? null,
      subject: subject ?? null,
      body_text: bodyText,
      body_html: received.email.html ?? null,
      provider_message_id: emailId,
      attribution,
    })
    .select("id")
    .single();
  if (insertError) {
    // Corrida com outra entrega do mesmo email_id — já foi gravado, não é erro.
    if (insertError.code === "23505") return json({ ok: true, duplicate: true }, 200);
    return json({ error: insertError.message }, 500);
  }

  const notifyIds = new Set(recipients.map((r) => r.user_id));
  notifyIds.add(parent.sender_id);
  if (matched?.user_id) notifyIds.delete(matched.user_id);

  if (notifyIds.size > 0) {
    await admin.from("checklist_step_email_reply_recipients").insert(
      [...notifyIds].map((user_id) => ({ reply_id: inserted.id, user_id }))
    );
  }

  return json({ ok: true }, 200);
}
