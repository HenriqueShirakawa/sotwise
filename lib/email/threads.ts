import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import type { StepOwner } from "@/lib/checklist-email-actions";
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
): Promise<{ id: string } | { error: string }> {
  const { data: existing } = await admin
    .from("email_threads")
    .select("id")
    .eq("order_id", orderId)
    .eq("kind", kind)
    .maybeSingle();
  if (existing) return { id: existing.id };

  const { data: inserted, error } = await admin
    .from("email_threads")
    .insert({ order_id: orderId, kind })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      const { data: retry } = await admin
        .from("email_threads")
        .select("id")
        .eq("order_id", orderId)
        .eq("kind", kind)
        .maybeSingle();
      if (retry) return { id: retry.id };
    }
    return { error: error.message };
  }
  if (!inserted) return { error: "Could not create the e-mail thread." };
  return { id: inserted.id };
}

export type ResolvedThread = { id: string; orderId: string; kind: EmailThreadKind };

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
    threads.push({ id: found.id, orderId: order.id, kind });
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
 * Promove o e-mail recém-inserido a âncora da thread, só se ela ainda não
 * tinha uma — UPDATE condicional (`where anchor_email_id is null`), seguro
 * contra corrida (a atualização perdedora afeta 0 linhas). `messageId` vem
 * `null` nesta fase (o Resend real só é consultado na Fase 2); o guard usa
 * `anchor_email_id`, não `anchor_message_id`, porque é o campo que já existe
 * de verdade agora — e continua sendo o guard certo depois da Fase 2 também.
 */
export async function promoteAnchorIfMissing(
  admin: Admin,
  threadId: string,
  emailId: string,
  messageId: string | null
): Promise<void> {
  await admin
    .from("email_threads")
    .update({ anchor_email_id: emailId, ...(messageId ? { anchor_message_id: messageId } : {}) })
    .eq("id", threadId)
    .is("anchor_email_id", null);
}
