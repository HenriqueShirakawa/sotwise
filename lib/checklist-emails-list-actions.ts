"use server";

import { requireFeature } from "@/lib/dal";
import { fetchAll } from "@/lib/fetch-all";
import { loadRepliesByEmailIds } from "@/lib/checklist-emails";
import { loadEntityContexts, loadProfileNames, type EntityRef } from "@/lib/messages";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EmailLanguage, MessageEntity, StepEmailRecipient, StepEmailStatus } from "@/types/database";

/**
 * Histórico de e-mails de checklist, AGRUPADO — Fase 2.1, User Story 3.
 *
 * Não dá pra listar "por pedido" ao pé da letra: um e-mail disparado de uma
 * etapa de Pre-loading/Shipment pode cobrir VÁRIOS pedidos (um PL consolida N
 * orders via `batches`). Reaproveita o mesmo agrupamento PO/PL que o módulo de
 * Mensagens já resolveu pra esse exato problema — duplicado aqui de propósito
 * (é 1 linha), mesma filosofia de `loadStepRecipientOptions` em
 * `lib/checklist-email-actions.ts`: módulos independentes, sem acoplar por uma
 * função de 1 linha.
 */
export type EmailRecordGroup = "po" | "pl";
const groupOf = (type: MessageEntity): EmailRecordGroup => (type === "order" ? "po" : "pl");

export type EmailListRow = {
  id: string;
  subject: string;
  status: StepEmailStatus | null;
  language: EmailLanguage | null;
  sender_name: string;
  recipients: StepEmailRecipient[];
  created_at: string;
  group: EmailRecordGroup;
  /** Número PO ou PL, resolvido via `lib/messages.ts` (mesmo contexto que a
   *  caixa de Mensagens usa pros mesmos registros). */
  number: string;
  /** Nome(s) do(s) cliente(s), já juntados por vírgula — PL/Shipment podem ter vários. */
  clients: string | null;
  /** Order que esta linha respondeu de verdade (`thread_id` →
   *  `email_threads.order_id`) — só resolvido pra `group === "pl"`; um `po`
   *  já É o próprio Order, sem ambiguidade nenhuma (ver `sendStepEmail`). */
  orderPoNumber: string | null;
  replyCount: number;
  unreadReplyCount: number;
};

export async function loadEmailRecords(): Promise<EmailListRow[]> {
  const session = await requireFeature("email_history");
  const admin = createAdminClient();

  const rows = await fetchAll<{
    id: string;
    subject: string;
    status: StepEmailStatus | null;
    language: EmailLanguage | null;
    sender_id: string;
    recipients: StepEmailRecipient[];
    created_at: string;
    checklist_step_id: string | null;
    pre_loading_step_id: string | null;
    thread_id: string | null;
  }>((from, to) =>
    admin
      .from("checklist_step_emails")
      .select(
        "id, subject, status, language, sender_id, recipients, created_at, checklist_step_id, pre_loading_step_id, thread_id"
      )
      .order("created_at", { ascending: false })
      .range(from, to)
  );
  if (rows.length === 0) return [];

  // Order que cada linha respondeu de verdade — só interessa pra linhas de
  // Pre-loading/Shipment (`group === "pl"`); um `po` já é o próprio Order.
  const threadIds = [...new Set(rows.map((r) => r.thread_id).filter((id): id is string => Boolean(id)))];
  const poNumberByThreadId = new Map<string, string>();
  if (threadIds.length > 0) {
    const { data: threadRows } = await admin.from("email_threads").select("id, order_id").in("id", threadIds);
    const orderIdByThreadId = new Map((threadRows ?? []).map((t) => [t.id, t.order_id]));
    const orderIds = [...new Set([...orderIdByThreadId.values()])];
    const { data: orderRows } = orderIds.length
      ? await admin.from("orders").select("id, po_number").in("id", orderIds)
      : { data: [] as { id: string; po_number: string }[] };
    const poNumberByOrderId = new Map((orderRows ?? []).map((o) => [o.id, o.po_number]));
    for (const [threadId, orderId] of orderIdByThreadId) {
      const po = poNumberByOrderId.get(orderId);
      if (po) poNumberByThreadId.set(threadId, po);
    }
  }

  const stepIds = [...new Set(rows.map((r) => r.checklist_step_id).filter((id): id is string => Boolean(id)))];
  const plStepIds = [
    ...new Set(rows.map((r) => r.pre_loading_step_id).filter((id): id is string => Boolean(id))),
  ];

  const orderIdByStep = new Map<string, string>();
  if (stepIds.length) {
    const { data } = await admin.from("order_checklist_steps").select("id, order_id").in("id", stepIds);
    for (const s of data ?? []) orderIdByStep.set(s.id, s.order_id);
  }
  const plIdByStep = new Map<string, string>();
  if (plStepIds.length) {
    const { data } = await admin
      .from("pre_loading_checklist_steps")
      .select("id, pre_loading_id")
      .in("id", plStepIds);
    for (const s of data ?? []) plIdByStep.set(s.id, s.pre_loading_id);
  }

  const entityByRowId = new Map<string, { type: MessageEntity; id: string }>();
  for (const r of rows) {
    const orderId = r.checklist_step_id ? orderIdByStep.get(r.checklist_step_id) : undefined;
    const plId = r.pre_loading_step_id ? plIdByStep.get(r.pre_loading_step_id) : undefined;
    if (orderId) entityByRowId.set(r.id, { type: "order", id: orderId });
    else if (plId) entityByRowId.set(r.id, { type: "pre_loading", id: plId });
    // Sem os dois: etapa foi apagada — cascade da FK já deveria ter levado a
    // linha junto, mas por segurança a linha some da lista em vez de quebrar.
  }

  const refs: EntityRef[] = [...entityByRowId.values()];
  const contexts = await loadEntityContexts(refs);
  const senderIds = [...new Set(rows.map((r) => r.sender_id))];
  const nameById = await loadProfileNames(senderIds);
  const repliesByEmailId = await loadRepliesByEmailIds(
    admin,
    rows.map((r) => r.id),
    session.userId
  );

  const out: EmailListRow[] = [];
  for (const r of rows) {
    const entity = entityByRowId.get(r.id);
    if (!entity) continue;
    const ctx = contexts.get(`${entity.type}:${entity.id}`);
    const replies = repliesByEmailId.get(r.id) ?? [];
    const group = groupOf(entity.type);
    out.push({
      id: r.id,
      subject: r.subject,
      status: r.status,
      language: r.language,
      sender_name: nameById.get(r.sender_id) ?? "—",
      recipients: r.recipients,
      created_at: r.created_at,
      group,
      number: ctx?.number ?? "—",
      clients: ctx?.clients.length ? ctx.clients.map((c) => c.name).join(", ") : null,
      orderPoNumber: group === "pl" && r.thread_id ? (poNumberByThreadId.get(r.thread_id) ?? null) : null,
      replyCount: replies.length,
      unreadReplyCount: replies.filter((reply) => !reply.read_by_me).length,
    });
  }
  return out;
}
