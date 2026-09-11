import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import type { StepOwner } from "@/lib/checklist-email-actions";
import { STEP_LABELS } from "@/lib/checklist";
import { threadKindForStep } from "@/lib/email/step-thread-kind";
import type { ChecklistStep, EmailThreadKind } from "@/types/database";

/**
 * Fase 1 do redesenho de e-mail de checklist (plano em
 * docs/regras_de_negocio.md): resolve/cria as até-2 threads (`email_threads`)
 * por Order que um envio de etapa deve atingir, e o bookkeeping de fan-out +
 * âncora. Helper puro (recebe o client do Supabase por parâmetro), mesmo
 * espírito de `lib/checklist-emails.ts` — não é Server Action.
 *
 * Nesta fase, nada disto muda o que chega na caixa de entrada: Reply-To e
 * cabeçalhos de e-mail continuam exatamente como hoje (por linha). É só
 * bookkeeping gravado ao lado, validado contra dados reais antes da Fase 2
 * (cabeçalho de verdade + Resend) passar a depender dele.
 */

type Admin = ReturnType<typeof createAdminClient>;

type OwnerOrder = { id: string; po_number: string };

/** Order(s) por trás da etapa que está enviando e-mail — 1 para Order, N
 *  (uma por pedido consolidado) para Pre-loading/Shipment (fan-out). */
async function resolveOwnerOrderIds(admin: Admin, owner: StepOwner): Promise<OwnerOrder[]> {
  if (owner.kind === "order") {
    const { data: step } = await admin
      .from("order_checklist_steps")
      .select("order_id")
      .eq("id", owner.stepId)
      .maybeSingle();
    if (!step?.order_id) return [];
    const { data: order } = await admin
      .from("orders")
      .select("id, po_number")
      .eq("id", step.order_id)
      .maybeSingle();
    return order ? [order] : [];
  }

  const { data: pbRows } = await admin
    .from("pre_loading_batches")
    .select("batch_id")
    .eq("pre_loading_id", owner.preLoadingId);
  const batchIds = [...new Set((pbRows ?? []).map((r) => r.batch_id))];
  if (batchIds.length === 0) return [];

  const { data: batchRows } = await admin.from("batches").select("order_id").in("id", batchIds);
  const orderIds = [...new Set((batchRows ?? []).map((r) => r.order_id))];
  if (orderIds.length === 0) return [];

  const { data: orders } = await admin.from("orders").select("id, po_number").in("id", orderIds);
  return orders ?? [];
}

/** Busca a thread `(order_id, kind)`; cria se ainda não existir. Corrida
 *  (dois envios concorrentes criando a mesma thread nova) tratada
 *  reconsultando pela unique (order_id, kind) em vez de estourar erro. */
async function findOrCreateThread(
  admin: Admin,
  orderId: string,
  kind: EmailThreadKind
): Promise<{ id: string; anchorMessageId: string | null } | { error: string }> {
  const { data: existing } = await admin
    .from("email_threads")
    .select("id, anchor_message_id")
    .eq("order_id", orderId)
    .eq("kind", kind)
    .maybeSingle();
  if (existing) return { id: existing.id, anchorMessageId: existing.anchor_message_id };

  const { data: inserted, error } = await admin
    .from("email_threads")
    .insert({ order_id: orderId, kind })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      const { data: retry } = await admin
        .from("email_threads")
        .select("id, anchor_message_id")
        .eq("order_id", orderId)
        .eq("kind", kind)
        .maybeSingle();
      if (retry) return { id: retry.id, anchorMessageId: retry.anchor_message_id };
    }
    return { error: error.message };
  }
  if (!inserted) return { error: "Could not create the e-mail thread." };
  return { id: inserted.id, anchorMessageId: null };
}

export type ResolvedThread = {
  id: string;
  orderId: string;
  kind: EmailThreadKind;
  /** Message-ID do e-mail-âncora — `null` enquanto a thread ainda não teve
   *  nenhum envio com Message-ID capturado (thread nova, ou só envios de antes
   *  da Fase 2). */
  anchorMessageId: string | null;
};

/**
 * Threads que um envio desta etapa deve atingir — a primeira da lista é
 * sempre a PRIMÁRIA (menor po_number; critério determinístico mesmo quando só
 * há 1 pedido). Sem nenhum pedido resolvido (ex.: Pre-loading sem lote
 * vinculado ainda), devolve erro em vez de um modo "sem thread" silencioso —
 * decisão do plano, para nunca quebrar a promessa de "todo envio pertence a
 * uma thread". Quem chama deve tratar isso ANTES de mandar qualquer e-mail.
 */
export async function resolveThreadsForSend(
  admin: Admin,
  owner: StepOwner,
  step: ChecklistStep
): Promise<{ ok: true; threads: ResolvedThread[] } | { ok: false; error: string }> {
  const orders = await resolveOwnerOrderIds(admin, owner);
  if (orders.length === 0) {
    return {
      ok: false,
      error:
        owner.kind === "order"
          ? "Could not find the order behind this step."
          : "This pre-loading has no order linked yet — cannot start an e-mail thread.",
    };
  }

  const kind = threadKindForStep(step);
  const ordered = [...orders].sort((a, b) => a.po_number.localeCompare(b.po_number));

  const threads: ResolvedThread[] = [];
  for (const order of ordered) {
    const found = await findOrCreateThread(admin, order.id, kind);
    if ("error" in found) return { ok: false, error: found.error };
    threads.push({ id: found.id, orderId: order.id, kind, anchorMessageId: found.anchorMessageId });
  }
  return { ok: true, threads };
}

/** Grava o fan-out — uma linha por thread atingida, inclusive a primária (ver
 *  comentário da migration 20260910120000: é só auditoria, ninguém lê esta
 *  tabela para decidir nada ainda). Chamado DEPOIS do insert em
 *  `checklist_step_emails` (a FK exige que a linha já exista). */
export async function recordThreadFanout(
  admin: Admin,
  threads: ResolvedThread[],
  emailId: string
): Promise<void> {
  if (threads.length === 0) return;
  await admin
    .from("checklist_step_email_threads")
    .insert(threads.map((t) => ({ checklist_step_email_id: emailId, thread_id: t.id })));
}

/**
 * Promove o e-mail recém-inserido a âncora da thread — só se ela ainda não
 * tinha uma. UPDATE condicional, seguro contra corrida (a atualização
 * perdedora afeta 0 linhas).
 *
 * A âncora "de verdade" é a primeira linha da thread COM Message-ID (é ela
 * que os próximos `In-Reply-To` apontam). Por isso o guard é
 * `anchor_message_id is null`: uma thread que só tinha envios da Fase 1 (sem
 * Message-ID capturado) ganha como âncora o primeiro envio da Fase 2 — os
 * e-mails anteriores ficam de fora da conversa no Gmail (decisão do plano:
 * nada migrado retroativamente). Sem `messageId` (todos os destinatários
 * falharam, ou o GET do Resend não devolveu), só preenche `anchor_email_id`
 * se estava vazio — mantém o bookkeeping da Fase 1, sem fingir uma âncora.
 */
export async function promoteAnchorIfMissing(
  admin: Admin,
  threadId: string,
  emailId: string,
  messageId: string | null
): Promise<void> {
  if (messageId) {
    await admin
      .from("email_threads")
      .update({ anchor_email_id: emailId, anchor_message_id: messageId })
      .eq("id", threadId)
      .is("anchor_message_id", null);
    return;
  }
  await admin
    .from("email_threads")
    .update({ anchor_email_id: emailId })
    .eq("id", threadId)
    .is("anchor_email_id", null);
}

export type ThreadingHeaders = { "In-Reply-To"?: string; References?: string };

/**
 * Cabeçalhos RFC 5322 que fazem o e-mail chegar como RESPOSTA na caixa de
 * entrada (Gmail/Outlook/Apple Mail agrupam por eles — confirmado no spike de
 * 11/09/2026 com o Resend): `In-Reply-To` = âncora da thread primária;
 * `References` = âncoras de todas as threads atingidas (fan-out de PL/
 * Shipment) + o Message-ID mais recente da thread primária, pra quem entrou
 * na conversa depois da âncora (ex.: cliente adicionado num envio posterior)
 * ainda ter um elo com a mensagem anterior.
 *
 * Objeto vazio quando nenhuma thread tem âncora ainda — este envio é o
 * primeiro da conversa e vira ele mesmo a âncora (`promoteAnchorIfMissing`).
 */
export async function threadingHeaders(admin: Admin, threads: ResolvedThread[]): Promise<ThreadingHeaders> {
  if (threads.length === 0) return {};
  const primary = threads[0];
  const anchors = threads.map((t) => t.anchorMessageId).filter((id): id is string => Boolean(id));
  const inReplyTo = primary.anchorMessageId ?? anchors[0];
  if (!inReplyTo) return {};

  const { data: latest } = await admin
    .from("checklist_step_emails")
    .select("message_id")
    .eq("thread_id", primary.id)
    .not("message_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const references = [...new Set([...anchors, latest?.message_id].filter((id): id is string => Boolean(id)))];
  return { "In-Reply-To": inReplyTo, References: references.join(" ") };
}

export type QuotedMessage = {
  sentAt: string;
  senderName: string;
  stepLabel: string;
  body: string;
};

/**
 * Mensagens anteriores da thread (mais recente primeiro), pra ir citadas no
 * rodapé do próximo envio — igual ao "Em <data>, <fulano> escreveu:" que o
 * Gmail/Outlook anexam num reply. Sem isto, cada reply chega mostrando só a
 * mensagem nova e, mesmo agrupado, "parece" e-mail avulso (feedback do
 * usuário em 11/09/2026). Cita TODAS as mensagens da thread (pedido do
 * usuário, mesma data) — o teto natural é o checklist (24 etapas × poucos
 * envios), e o Gmail colapsa o bloco atrás do "..." de qualquer forma.
 */
export async function loadQuotedHistory(admin: Admin, threadId: string): Promise<QuotedMessage[]> {
  const { data: rows } = await admin
    .from("checklist_step_emails")
    .select("body, sender_id, created_at, checklist_step_id, pre_loading_step_id")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false });
  if (!rows?.length) return [];

  const senderIds = [...new Set(rows.map((r) => r.sender_id))];
  const orderStepIds = rows.map((r) => r.checklist_step_id).filter((id): id is string => Boolean(id));
  const plStepIds = rows.map((r) => r.pre_loading_step_id).filter((id): id is string => Boolean(id));

  const [{ data: senders }, { data: orderSteps }, { data: plSteps }] = await Promise.all([
    admin.from("profiles").select("id, full_name").in("id", senderIds),
    orderStepIds.length
      ? admin.from("order_checklist_steps").select("id, step").in("id", orderStepIds)
      : Promise.resolve({ data: [] as { id: string; step: ChecklistStep }[] }),
    plStepIds.length
      ? admin.from("pre_loading_checklist_steps").select("id, step").in("id", plStepIds)
      : Promise.resolve({ data: [] as { id: string; step: ChecklistStep }[] }),
  ]);
  const nameById = new Map((senders ?? []).map((s) => [s.id, s.full_name]));
  const stepById = new Map<string, ChecklistStep>([
    ...(orderSteps ?? []).map((s) => [s.id, s.step] as const),
    ...(plSteps ?? []).map((s) => [s.id, s.step] as const),
  ]);

  return rows.map((r) => {
    const step = stepById.get(r.checklist_step_id ?? r.pre_loading_step_id ?? "");
    return {
      sentAt: r.created_at,
      senderName: nameById.get(r.sender_id) ?? "—",
      stepLabel: step ? STEP_LABELS[step] : "",
      body: r.body,
    };
  });
}

/**
 * Versão só-leitura de `resolveThreadsForSend` pro PREVIEW: acha a thread
 * primária que o envio usaria, sem criar nada, e devolve o histórico citado
 * que o e-mail de verdade levaria. Lista vazia = thread ainda não existe
 * (o envio seria o primeiro da conversa).
 */
export async function peekQuotedHistory(admin: Admin, owner: StepOwner, step: ChecklistStep): Promise<QuotedMessage[]> {
  const orders = await resolveOwnerOrderIds(admin, owner);
  if (orders.length === 0) return [];
  const primary = [...orders].sort((a, b) => a.po_number.localeCompare(b.po_number))[0];
  const { data: thread } = await admin
    .from("email_threads")
    .select("id")
    .eq("order_id", primary.id)
    .eq("kind", threadKindForStep(step))
    .maybeSingle();
  return thread ? loadQuotedHistory(admin, thread.id) : [];
}
