import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import type {
  EmailDeliveryEvent,
  EmailDeliveryIssue,
  StepEmailRecipient,
} from "@/types/database";

/**
 * Bounce / falha de entrega dos e-mails por etapa, avisados DEPOIS do envio
 * pelo webhook do Resend (tabela `email_delivery_events`, migration
 * 20260925140000). `recipients[].ok` só diz que o Resend aceitou o envio — o
 * chip do destinatário usa isto pra mostrar que o e-mail não chegou.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

/** Eventos do Resend que significam "não chegou", no nome que gravamos. */
export const RESEND_DELIVERY_EVENTS: Record<string, EmailDeliveryEvent> = {
  "email.bounced": "bounced",
  "email.failed": "failed",
  "email.suppressed": "suppressed",
  "email.complained": "complained",
};

// Mais grave primeiro: se o mesmo destinatário tiver mais de um evento, o chip
// mostra este.
const SEVERITY: EmailDeliveryEvent[] = ["bounced", "suppressed", "failed", "complained"];

/**
 * Anexa `delivery_issue` aos destinatários de cada linha. Sem a tabela (antes
 * da migration) ou com erro na leitura, devolve as linhas como vieram — o
 * alerta é informativo, não pode derrubar o histórico.
 */
export async function withDeliveryIssues<T extends { id: string; recipients: StepEmailRecipient[] }>(
  admin: AdminClient,
  rows: T[]
): Promise<T[]> {
  if (rows.length === 0) return rows;
  const { data, error } = await admin
    .from("email_delivery_events")
    .select("checklist_step_email_id, email, event, reason, occurred_at")
    .in(
      "checklist_step_email_id",
      rows.map((r) => r.id)
    );
  if (error || !data || data.length === 0) return rows;

  const issueByKey = new Map<string, EmailDeliveryIssue>();
  for (const e of data) {
    const key = `${e.checklist_step_email_id}|${e.email.toLowerCase()}`;
    const current = issueByKey.get(key);
    if (!current || SEVERITY.indexOf(e.event) < SEVERITY.indexOf(current.event)) {
      issueByKey.set(key, { event: e.event, reason: e.reason, occurred_at: e.occurred_at });
    }
  }

  return rows.map((row) => ({
    ...row,
    recipients: row.recipients.map((rc) => ({
      ...rc,
      delivery_issue: issueByKey.get(`${row.id}|${rc.email.toLowerCase()}`) ?? null,
    })),
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
