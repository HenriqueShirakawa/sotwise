import "server-only";

import { fetchAll } from "@/lib/fetch-all";
import { fetchEmailLastEvent } from "@/lib/email/resend";
import type { createAdminClient } from "@/lib/supabase/admin";
import type {
  EmailDelivery,
  EmailDeliveryEvent,
  EmailDeliveryIssue,
  EmailDeliveryProblem,
  StepEmailRecipient,
} from "@/types/database";

/**
 * Destino de cada destinatário dos e-mails por etapa (tabela
 * `email_delivery_events`). `recipients[].ok` só diz que o Resend ACEITOU o
 * envio; se chegou ou voltou vem depois, por dois caminhos:
 *  - consulta (29/09/2026): cada destinatário é um envio próprio
 *    (`recipients[].provider_id`) e a tela pergunta ao Resend, em intervalo, o
 *    status de cada um (`GET /emails/:id`) até virar entregue ou devolvido —
 *    `withDeliveryStatus(..., { refresh: true })`;
 *  - webhook do Resend (`recordDeliveryEvent`), que segue como reforço.
 * Com um e-mail só para todos, o Resend dava UM status para a mensagem inteira
 * ("delivered" se alguém recebeu) e o bounce de um destinatário sumia.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

/** Eventos do Resend que significam "não chegou", no nome que gravamos. */
export const RESEND_DELIVERY_EVENTS: Record<string, EmailDeliveryProblem> = {
  "email.bounced": "bounced",
  "email.failed": "failed",
  "email.suppressed": "suppressed",
  "email.complained": "complained",
};

/** `last_event` do Resend que encerra a consulta, no nome que gravamos. Aberto
 *  e clicado só acontecem depois de entregue. Os demais ("sent", "queued",
 *  "delivery_delayed"…) ainda não são resposta final. */
const FINAL_LAST_EVENT: Record<string, EmailDeliveryEvent> = {
  delivered: "delivered",
  opened: "delivered",
  clicked: "delivered",
  bounced: "bounced",
  failed: "failed",
  suppressed: "suppressed",
  complained: "complained",
  canceled: "failed",
};

// Mais grave primeiro: se o mesmo destinatário tiver mais de um problema, o
// chip mostra este. Problema vence "delivered" (bounce tardio, spam).
const SEVERITY: EmailDeliveryProblem[] = ["bounced", "suppressed", "failed", "complained"];

/** Até quando vale perguntar ao Resend. O servidor do destinatário responde em
 *  segundos; mesmo um atraso vira entregue ou devolvido em menos de um dia. */
const TRACK_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/** Consultas ao Resend por chamada — a tela chama de novo logo em seguida. */
const MAX_CHECKS = 20;

type DeliveryRow = { id: string; created_at: string; recipients: StepEmailRecipient[] };
type Known = { issue: EmailDeliveryIssue | null; deliveredAt: string | null };

const keyOf = (rowId: string, email: string) => `${rowId}|${email.trim().toLowerCase()}`;
const isTracked = (row: DeliveryRow, now: number) => now - Date.parse(row.created_at) < TRACK_WINDOW_MS;

function remember(known: Map<string, Known>, key: string, event: EmailDeliveryEvent, reason: string | null, at: string) {
  const current = known.get(key) ?? { issue: null, deliveredAt: null };
  if (event === "delivered") {
    current.deliveredAt ??= at;
  } else if (!current.issue || SEVERITY.indexOf(event) < SEVERITY.indexOf(current.issue.event)) {
    current.issue = { event, reason, occurred_at: at };
  }
  known.set(key, current);
}

/** O que já está gravado para estas linhas. Em blocos de linhas e paginado: a
 *  lista de E-mails pede o histórico inteiro, e com um "delivered" por
 *  destinatário a tabela passa fácil do teto de 1000 do PostgREST. */
async function loadKnown(admin: AdminClient, rowIds: string[]): Promise<Map<string, Known>> {
  const known = new Map<string, Known>();
  for (let i = 0; i < rowIds.length; i += 100) {
    const ids = rowIds.slice(i, i + 100);
    const events = await fetchAll<{
      checklist_step_email_id: string;
      email: string;
      event: EmailDeliveryEvent;
      reason: string | null;
      occurred_at: string;
    }>((from, to) =>
      admin
        .from("email_delivery_events")
        .select("checklist_step_email_id, email, event, reason, occurred_at")
        .in("checklist_step_email_id", ids)
        .order("id")
        .range(from, to)
    );
    for (const e of events) {
      remember(known, keyOf(e.checklist_step_email_id, e.email), e.event, e.reason, e.occurred_at);
    }
  }
  return known;
}

/**
 * Pergunta ao Resend por quem ainda não tem resposta final nestas linhas e
 * grava o que já é final (atualiza `known` também, para a resposta da tela
 * sair certa mesmo se a gravação falhar). Devolve quem segue em atraso.
 */
async function refreshFromResend(
  admin: AdminClient,
  rows: DeliveryRow[],
  known: Map<string, Known>,
  now: number
): Promise<Set<string>> {
  const pending = rows
    .filter((row) => isTracked(row, now))
    .flatMap((row) =>
      row.recipients
        .filter((rc) => {
          const k = known.get(keyOf(row.id, rc.email));
          return rc.ok && rc.provider_id && !k?.issue && !k?.deliveredAt;
        })
        .map((rc) => ({ row, rc, providerId: rc.provider_id as string }))
    )
    .slice(0, MAX_CHECKS);

  const delayed = new Set<string>();
  const found: {
    checklist_step_email_id: string;
    email: string;
    event: EmailDeliveryEvent;
    provider_email_id: string;
    occurred_at: string;
  }[] = [];
  // Duas por vez: o limite do Resend é 10 requests/s para o time inteiro.
  for (let i = 0; i < pending.length; i += 2) {
    await Promise.all(
      pending.slice(i, i + 2).map(async ({ row, rc, providerId }) => {
        const lastEvent = await fetchEmailLastEvent(providerId);
        const key = keyOf(row.id, rc.email);
        const event = lastEvent ? FINAL_LAST_EVENT[lastEvent] : undefined;
        if (!event) {
          if (lastEvent === "delivery_delayed") delayed.add(key);
          return;
        }
        const at = new Date().toISOString();
        remember(known, key, event, null, at);
        found.push({
          checklist_step_email_id: row.id,
          email: rc.email.trim().toLowerCase(),
          event,
          provider_email_id: providerId,
          occurred_at: at,
        });
      })
    );
  }

  // Problemas e "delivered" em gravações separadas: sem a migration
  // 20260929140000 o check da tabela recusa "delivered", e o problema — que é
  // o que precisa aparecer — não pode cair junto.
  const batches = [found.filter((f) => f.event !== "delivered"), found.filter((f) => f.event === "delivered")];
  for (const batch of batches) {
    if (batch.length === 0) continue;
    const { error } = await admin.from("email_delivery_events").upsert(batch, {
      onConflict: "checklist_step_email_id,email,event",
      ignoreDuplicates: true,
    });
    if (error) console.error("[email-delivery] could not record status:", error.message);
  }
  return delayed;
}

/**
 * Anexa `delivery_issue` (não chegou) e `delivery` (a caminho / entregue) aos
 * destinatários de cada linha. Com `refresh`, antes pergunta ao Resend por quem
 * ainda não tem resposta final — é o que a tela chama em intervalo; sem ele, só
 * lê o que já está gravado (carregar a página não consulta o Resend). Erro na
 * leitura não derruba o histórico: o status é informativo.
 */
export async function withDeliveryStatus<T extends DeliveryRow>(
  admin: AdminClient,
  rows: T[],
  { refresh = false }: { refresh?: boolean } = {}
): Promise<T[]> {
  if (rows.length === 0) return rows;
  const now = Date.now();
  const known = await loadKnown(
    admin,
    rows.map((r) => r.id)
  ).catch(() => new Map<string, Known>());
  const delayed = refresh ? await refreshFromResend(admin, rows, known, now) : new Set<string>();

  return rows.map((row) => ({
    ...row,
    recipients: row.recipients.map((rc): StepEmailRecipient => {
      const key = keyOf(row.id, rc.email);
      const k = known.get(key);
      if (k?.issue) return { ...rc, delivery_issue: k.issue, delivery: null };
      if (k?.deliveredAt) {
        return { ...rc, delivery_issue: null, delivery: { state: "delivered", at: k.deliveredAt } };
      }
      // Envio antigo (uma mensagem para todos, sem id por destinatário) ou
      // recusado pelo Resend na hora: não há o que consultar.
      if (!rc.ok || !rc.provider_id) return { ...rc, delivery_issue: null, delivery: null };
      const state: EmailDelivery["state"] = !isTracked(row, now)
        ? "unconfirmed"
        : delayed.has(key)
          ? "delayed"
          : "sending";
      return { ...rc, delivery_issue: null, delivery: { state, at: null } };
    }),
  }));
}

type ResendDeliveryPayload = {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    message_id?: string;
    to?: string[];
    bounce?: { message?: string; type?: string; subType?: string };
    failed?: { reason?: string };
    reason?: string;
  };
};

/**
 * Grava um evento de entrega vindo do webhook. Casa o e-mail pelo `message_id`
 * (a linha guarda o de cada destinatário em `recipients[].message_id`, e o
 * primeiro em `message_id`) e registra cada endereço de `data.to` que for
 * destinatário daquela linha. Devolve quantos destinatários foram marcados.
 */
export async function recordDeliveryEvent(
  admin: AdminClient,
  payload: ResendDeliveryPayload
): Promise<{ ok: true; recorded: number } | { ok: false; error: string }> {
  const event = RESEND_DELIVERY_EVENTS[payload.type];
  const messageId = payload.data?.message_id;
  if (!event || !messageId) return { ok: true, recorded: 0 };

  const [byRow, byRecipient] = await Promise.all([
    admin.from("checklist_step_emails").select("id, recipients").eq("message_id", messageId),
    admin
      .from("checklist_step_emails")
      .select("id, recipients")
      .contains("recipients", JSON.stringify([{ message_id: messageId }])),
  ]);
  if (byRow.error) return { ok: false, error: byRow.error.message };
  if (byRecipient.error) return { ok: false, error: byRecipient.error.message };

  const rows = new Map(
    [...(byRow.data ?? []), ...(byRecipient.data ?? [])].map((r) => [
      r.id,
      r.recipients as StepEmailRecipient[],
    ])
  );
  if (rows.size === 0) return { ok: true, recorded: 0 };

  const affected = new Set((payload.data?.to ?? []).map((e) => e.trim().toLowerCase()));
  const reason =
    payload.data?.bounce?.message ?? payload.data?.failed?.reason ?? payload.data?.reason ?? null;

  const inserts = [...rows].flatMap(([rowId, recipients]) =>
    recipients
      .filter((rc) => affected.has(rc.email.trim().toLowerCase()))
      .map((rc) => ({
        checklist_step_email_id: rowId,
        email: rc.email.trim().toLowerCase(),
        event,
        reason,
        provider_email_id: payload.data?.email_id ?? null,
        occurred_at: payload.created_at ?? new Date().toISOString(),
      }))
  );
  if (inserts.length === 0) return { ok: true, recorded: 0 };

  const { error } = await admin
    .from("email_delivery_events")
    .upsert(inserts, {
      onConflict: "checklist_step_email_id,email,event",
      ignoreDuplicates: true,
    });
  if (error) return { ok: false, error: error.message };
  return { ok: true, recorded: inserts.length };
}
