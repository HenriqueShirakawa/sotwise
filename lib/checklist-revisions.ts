import "server-only";

import { allBatchesInPreLoading } from "@/lib/checklist-completion";
import { todayIso } from "@/lib/format";
import { writeStepLog } from "@/lib/checklist-step-log";
import type { createAdminClient } from "@/lib/supabase/admin";
import type {
  BatchStatus,
  ChecklistRevisionKind,
  ChecklistRevisionSource,
  ChecklistStep,
} from "@/types/database";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Etapas do checklist da Order com gatilho próprio + revisões (20/10/2026,
 * planilha "checklistregras" + card "Deposit Payment", docs §3.7.5):
 *
 *  - **Order**: o usuário grava o "Order received date" (data do pedido final do
 *    cliente). A 1ª gravação conclui a etapa com Completed on = HOJE; cada troca
 *    depois exige motivo e vira revisão.
 *  - **PO**: conclui quando as Factory × Category chegam do GSS. Cada leva que
 *    muda o conjunto de F×C ativas é registrada (lista + o que mudou).
 *  - **PI**: o GSS manda o status da PI (texto livre) + data. O 1º status conclui
 *    a etapa com Completed on = data dele; os seguintes são revisões.
 *  - **Deposit Payment**: o usuário grava o "Deposit date" (quando o cliente
 *    depositou de fato), sempre com motivo. A 1ª gravação conclui a etapa com
 *    Completed on = o dia da gravação.
 *  - **Place the Order**: conclui quando a 1ª fábrica do pedido recebe
 *    documento (Completed on = hoje). Sem revisões — só o History.
 *
 * A 1ª linha de cada tipo (`order_received_date`, `fxc`, `pi_status`,
 * `deposit_date`) é o registro ORIGINAL — nunca se perde. Revisões = as linhas
 * depois dela (as antigas de `completed_on` são correções manuais de antes de
 * 22/10/2026).
 *
 * **Completed on = a ÚLTIMA atualização (22/10/2026, decisão do usuário):** toda
 * mudança do dado que conclui a etapa regrava o Completed on com o dia dela — e
 * ninguém o edita à mão, nem o admin. O gatilho nunca REABRE a etapa.
 */

/** O que o GSS grava como motivo quando a revisão vem dele. */
const GSS_REASON = "Updated by GSS";

type Who = { source: ChecklistRevisionSource; userId: string | null; reason?: string | null };

type StepRow = { id: string; step: ChecklistStep; completed_on: string | null };

async function readStep(admin: Admin, orderId: string, step: ChecklistStep): Promise<StepRow | null> {
  const { data, error } = await admin
    .from("order_checklist_steps")
    .select("id, step, completed_on")
    .eq("order_id", orderId)
    .eq("step", step)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Grava o Completed on pelo gatilho — a cada atualização do dado da etapa, não
 * só na 1ª (22/10/2026: Completed on = a última atualização). Signed by = quem
 * fez (null quando veio do GSS).
 */
async function completeByTrigger(
  admin: Admin,
  step: StepRow,
  completedOn: string,
  userId: string | null
): Promise<void> {
  const { error } = await admin
    .from("order_checklist_steps")
    .update({ completed_on: completedOn, done: true, signed_by_id: userId })
    .eq("id", step.id);
  if (error) throw new Error(error.message);
  if (step.completed_on === completedOn) return;
  await writeStepLog(admin, {
    owner: { checklistStepId: step.id },
    step: step.step,
    action: "auto_complete",
    changes: { completed_on: { from: step.completed_on, to: completedOn } },
    userId,
  });
}

async function insertRevision(
  admin: Admin,
  row: {
    order_id: string;
    step_id: string;
    kind: ChecklistRevisionKind;
    previous_date?: string | null;
    new_date?: string | null;
    payload?: Record<string, unknown>;
    reason?: string | null;
  },
  who: Who
): Promise<void> {
  const { error } = await admin.from("checklist_step_revisions").insert({
    ...row,
    source: who.source,
    changed_by: who.source === "manual" ? who.userId : null,
  });
  if (error) throw new Error(error.message);
}

function reasonFor(who: Who): string | null {
  const reason = who.reason?.trim();
  if (reason) return reason;
  return who.source === "gss" ? GSS_REASON : null;
}

// ── Order ────────────────────────────────────────────────────────────────────

/**
 * Grava o "Order received date". 1ª vez: conclui a etapa Order (Completed on =
 * hoje). Depois: revisão com motivo obrigatório (o GSS grava "Updated by GSS").
 * Retorna a mensagem de erro de validação, ou null.
 */
export async function setOrderReceivedDate(
  admin: Admin,
  orderId: string,
  date: string,
  who: Who
): Promise<string | null> {
  if (date > todayIso()) return "The order received date can't be in the future.";

  const { data: order, error } = await admin
    .from("orders")
    .select("order_received_date")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) return "Order not found.";

  const previous = order.order_received_date;
  if (previous === date) return null;

  const reason = reasonFor(who);
  if (previous && !reason) return "A reason is required to revise the order received date.";

  const step = await readStep(admin, orderId, "order");
  if (!step) return "Checklist step not found.";

  const { error: upError } = await admin
    .from("orders")
    .update({ order_received_date: date })
    .eq("id", orderId);
  if (upError) throw new Error(upError.message);

  await insertRevision(
    admin,
    {
      order_id: orderId,
      step_id: step.id,
      kind: "order_received_date",
      previous_date: previous,
      new_date: date,
      reason: previous ? reason : null,
    },
    who
  );

  // A troca aparece no History da etapa (é lá que a tela mostra, não num log
  // à parte); writeStepLog ignora o que não veio de usuário.
  await writeStepLog(admin, {
    owner: { checklistStepId: step.id },
    step: step.step,
    action: "update",
    changes: {
      order_received_date: { from: previous, to: date },
      ...(previous && reason ? { reason } : {}),
    },
    userId: who.userId,
  });

  // Completed on = o MOMENTO da última gravação (não a data em si) — a cada troca.
  await completeByTrigger(admin, step, todayIso(), who.userId);
  return null;
}

// ── Deposit Payment ──────────────────────────────────────────────────────────

/**
 * Grava o "Deposit date" — a data em que o cliente de fato depositou (card do
 * cliente, 20/10/2026). MOTIVO é obrigatório em TODA gravação, inclusive a 1ª
 * (decisão do usuário; difere do Order received date, cujo 1º registro é livre).
 *
 * A 1ª gravação conclui a etapa com Completed on = o DIA DA GRAVAÇÃO, não a data
 * do depósito — mesmo critério do Order. Revisar depois troca só o Deposit date.
 * Retorna a mensagem de erro de validação, ou null.
 */
export async function setDepositDate(
  admin: Admin,
  orderId: string,
  date: string,
  who: Who
): Promise<string | null> {
  if (date > todayIso()) return "The deposit date can't be in the future.";

  const { data: order, error } = await admin
    .from("orders")
    .select("deposit_date")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) return "Order not found.";

  const previous = order.deposit_date;
  if (previous === date) return null;

  const reason = reasonFor(who);
  if (!reason) return "A reason is required to record the deposit date.";

  const step = await readStep(admin, orderId, "deposit_payment");
  if (!step) return "Checklist step not found.";

  const { error: upError } = await admin
    .from("orders")
    .update({ deposit_date: date })
    .eq("id", orderId);
  if (upError) throw new Error(upError.message);

  await insertRevision(
    admin,
    {
      order_id: orderId,
      step_id: step.id,
      kind: "deposit_date",
      previous_date: previous,
      new_date: date,
      reason,
    },
    who
  );

  // A gravação aparece no History da etapa, com o motivo (badge "Correction").
  await writeStepLog(admin, {
    owner: { checklistStepId: step.id },
    step: step.step,
    action: "update",
    changes: { deposit_date: { from: previous, to: date }, reason },
    userId: who.userId,
  });

  // Completed on = o MOMENTO da última gravação (não a data do depósito).
  await completeByTrigger(admin, step, todayIso(), who.userId);
  return null;
}
// ── PO ───────────────────────────────────────────────────────────────────────

export type FxcItem = {
  ofc_id: string;
  factory_id: string;
  factory: string;
  category_id: string;
  category: string;
};

const pairKey = (i: { factory_id: string; category_id: string }) =>
  `${i.factory_id}:${i.category_id}`;

/** F×C ATIVAS da order, já com o nome de fábrica e categoria. */
async function readActiveFxc(admin: Admin, orderId: string): Promise<FxcItem[]> {
  const { data, error } = await admin
    .from("order_factory_category")
    .select("id, factory_id, category_id")
    .eq("order_id", orderId)
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const factoryIds = [...new Set(rows.map((r) => r.factory_id))];
  const categoryIds = [...new Set(rows.map((r) => r.category_id))];
  const [factories, categories] = await Promise.all([
    admin.from("factories").select("id, name").in("id", factoryIds),
    admin.from("categories").select("id, name").in("id", categoryIds),
  ]);
  const factoryName = new Map((factories.data ?? []).map((f) => [f.id, f.name]));
  const categoryName = new Map((categories.data ?? []).map((c) => [c.id, c.name]));

  // Um par por linha (a order não deveria ter par repetido; se tiver, colapsa).
  const byPair = new Map<string, FxcItem>();
  for (const r of rows) {
    const item: FxcItem = {
      ofc_id: r.id,
      factory_id: r.factory_id,
      factory: factoryName.get(r.factory_id) ?? "—",
      category_id: r.category_id,
      category: categoryName.get(r.category_id) ?? "—",
    };
    if (!byPair.has(pairKey(item))) byPair.set(pairKey(item), item);
  }
  return [...byPair.values()].sort(
    (a, b) => a.factory.localeCompare(b.factory) || a.category.localeCompare(b.category)
  );
}

/**
 * Registra uma "leva" de Factory × Category recebida do GSS. Chamada DEPOIS de
 * cada escrita da API nas F×C da order (uma chamada = uma leva). Compara o
 * conjunto ativo com o da última leva: igual → nada; diferente → nova linha
 * com o que entrou e o que saiu. A 1ª leva conclui o PO (Completed on = hoje).
 *
 * Nunca derruba a escrita que a chamou — erro só vai pro console.
 */
export async function recordFxcDelivery(
  admin: Admin,
  orderId: string,
  who: Who = { source: "gss", userId: null }
): Promise<void> {
  try {
    const items = await readActiveFxc(admin, orderId);

    const { data: last, error } = await admin
      .from("checklist_step_revisions")
      .select("payload")
      .eq("order_id", orderId)
      .eq("kind", "fxc")
      .order("changed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const previous = (last?.payload?.items as FxcItem[] | undefined) ?? null;
    if (!previous && items.length === 0) return;

    const before = new Map((previous ?? []).map((i) => [pairKey(i), i]));
    const after = new Map(items.map((i) => [pairKey(i), i]));
    const added = items.filter((i) => !before.has(pairKey(i)));
    const removed = (previous ?? []).filter((i) => !after.has(pairKey(i)));
    if (previous && added.length === 0 && removed.length === 0) return;

    const step = await readStep(admin, orderId, "po");
    if (!step) return;

    const today = todayIso();
    await insertRevision(
      admin,
      {
        order_id: orderId,
        step_id: step.id,
        kind: "fxc",
        new_date: today,
        payload: { items, added, removed },
        reason: previous ? reasonFor(who) : null,
      },
      who
    );

    // Cada leva que muda o conjunto regrava o Completed on (a última atualização).
    await completeByTrigger(admin, step, today, who.userId);
  } catch (err) {
    console.error("[checklist-revisions] fxc", err instanceof Error ? err.message : err);
  }
}

// ── Place the Order ──────────────────────────────────────────────────────────

/**
 * Place the Order (20/10/2026, card "Ajustes Data e Logs"): cada fábrica do
 * pedido ganha a sua data quando recebe o 1º documento (o upload já vai pro
 * History com a fábrica). Quando a 1ª fábrica recebe documento (21/10/2026;
 * antes era a ÚLTIMA), a etapa conclui sozinha — Completed on = hoje, Signed by
 * = quem anexou.
 * Chamada depois de cada anexo da etapa; nunca derruba o upload.
 */
export async function completePlaceTheOrderIfCovered(
  admin: Admin,
  stepId: string,
  userId: string
): Promise<void> {
  try {
    const { data: step, error } = await admin
      .from("order_checklist_steps")
      .select("id, order_id, step, completed_on")
      .eq("id", stepId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!step || step.step !== "place_the_order") return;

    const [ofcRes, attRes] = await Promise.all([
      admin
        .from("order_factory_category")
        .select("factory_id")
        .eq("order_id", step.order_id)
        .eq("is_active", true),
      admin.from("step_attachments").select("factory_id").eq("checklist_step_id", stepId),
    ]);
    if (ofcRes.error) throw new Error(ofcRes.error.message);
    if (attRes.error) throw new Error(attRes.error.message);

    // Basta UMA fábrica do pedido com documento (21/10/2026; antes eram todas).
    const factories = new Set((ofcRes.data ?? []).map((o) => o.factory_id));
    const anyWithDoc = (attRes.data ?? []).some((a) => !!a.factory_id && factories.has(a.factory_id));
    if (!anyWithDoc) return;

    await completeByTrigger(admin, step, todayIso(), userId);
  } catch (err) {
    console.error("[checklist-revisions] place_the_order", err instanceof Error ? err.message : err);
  }
}

// ── Pre-Loading (etapa da Order) ─────────────────────────────────────────────

/**
 * Pre-Loading da Order (22/10/2026): conclui quando TODOS os lotes da Order
 * (fora os cancelados) estão em Pre-Loading ou adiante. Chamada quando lotes
 * entram num PL (domain/pre-loadings/write `syncPreLoadingRelations`) — cada
 * lote que entra num PL é atualização da etapa, então, com a condição cumprida,
 * o Completed on vira o dia dela (a última atualização). Nunca reabre: lote novo
 * da Order ainda fora de PL só deixa a etapa pendente no ícone.
 */
export async function completeOrderPreLoadingIfReady(
  admin: Admin,
  orderIds: string[],
  userId: string | null
): Promise<void> {
  const ids = [...new Set(orderIds)].filter(Boolean);
  if (ids.length === 0) return;
  try {
    const { data: batches, error } = await admin
      .from("batches")
      .select("order_id, status")
      .in("order_id", ids)
      .neq("status", "canceled");
    if (error) throw new Error(error.message);

    const byOrder = new Map<string, BatchStatus[]>();
    for (const b of batches ?? []) {
      byOrder.set(b.order_id, [...(byOrder.get(b.order_id) ?? []), b.status]);
    }
    for (const orderId of ids) {
      const statuses = byOrder.get(orderId) ?? [];
      if (!allBatchesInPreLoading(statuses)) continue;
      const step = await readStep(admin, orderId, "pre_loading");
      if (step) await completeByTrigger(admin, step, todayIso(), userId);
    }
  } catch (err) {
    console.error("[checklist-revisions] pre_loading", err instanceof Error ? err.message : err);
  }
}

// ── ETD ──────────────────────────────────────────────────────────────────────

/**
 * ETD (21/10/2026): conclui sozinha quando TODAS as entradas Factory × Category
 * ativas do pedido têm "Initial Date" — Completed on = hoje, Signed by = quem
 * preencheu a última (null pela API do GSS). Chamada depois de cada gravação
 * de Initial Date (tela, modal e PATCH /api/etd-factories); nunca derruba a
 * gravação.
 */
export async function completeEtdIfFilled(
  admin: Admin,
  orderId: string,
  userId: string | null
): Promise<void> {
  try {
    const step = await readStep(admin, orderId, "etd");
    if (!step) return;

    const { data: lines, error } = await admin
      .from("order_factory_category")
      .select("id")
      .eq("order_id", orderId)
      .eq("is_active", true);
    if (error) throw new Error(error.message);
    const ids = (lines ?? []).map((l) => l.id);
    if (ids.length === 0) return;

    const { data: etds, error: etdError } = await admin
      .from("etd_info")
      .select("order_factory_category_id")
      .in("order_factory_category_id", ids)
      .not("initial_date", "is", null);
    if (etdError) throw new Error(etdError.message);
    if ((etds ?? []).length < ids.length) return;

    await completeByTrigger(admin, step, todayIso(), userId);
  } catch (err) {
    console.error("[checklist-revisions] etd", err instanceof Error ? err.message : err);
  }
}

// ── PI ───────────────────────────────────────────────────────────────────────

/**
 * Status da PI vindo do GSS (texto livre) + data. O 1º conclui a PI com
 * Completed on = a data do status; os seguintes viram revisões. Mesmo status e
 * mesma data de novo → nada.
 */
export async function recordPiStatus(
  admin: Admin,
  orderId: string,
  status: string,
  date: string,
  who: Who
): Promise<string | null> {
  const clean = status.trim();
  if (!clean) return "pi_status can't be empty.";

  const { data: order, error } = await admin
    .from("orders")
    .select("pi_status, pi_status_date")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) return "Order not found.";
  if (order.pi_status === clean && order.pi_status_date === date) return null;

  const step = await readStep(admin, orderId, "pi");
  if (!step) return "Checklist step not found.";

  const { error: upError } = await admin
    .from("orders")
    .update({ pi_status: clean, pi_status_date: date })
    .eq("id", orderId);
  if (upError) throw new Error(upError.message);

  const first = !order.pi_status && !order.pi_status_date;
  await insertRevision(
    admin,
    {
      order_id: orderId,
      step_id: step.id,
      kind: "pi_status",
      previous_date: order.pi_status_date,
      new_date: date,
      payload: { status: clean, previous_status: order.pi_status },
      reason: first ? null : reasonFor(who),
    },
    who
  );

  // Cada status novo regrava o Completed on com a data dele (a última
  // atualização). Nunca futuro: status com data adiante fica com hoje.
  const today = todayIso();
  await completeByTrigger(admin, step, date > today ? today : date, who.userId);
  return null;
}

// ── Leitura ──────────────────────────────────────────────────────────────────

export type StepRevisionSummary = {
  /** Número do badge: todas as linhas menos o registro original de cada tipo. */
  count: number;
  /** Data do registro ORIGINAL — o painel mostra a 1ª data, não a vigente. */
  originalDate: string | null;
};

/** Resumo das revisões de cada etapa, para o badge e a data original. */
export async function summarizeRevisionsByStep(
  admin: Admin,
  stepIds: string[]
): Promise<Record<string, StepRevisionSummary>> {
  if (stepIds.length === 0) return {};
  const { data, error } = await admin
    .from("checklist_step_revisions")
    .select("step_id, kind, new_date")
    .in("step_id", stepIds)
    .order("changed_at", { ascending: true });
  if (error) {
    // Migration ainda não aplicada: tela segue sem badge.
    console.error("[checklist-revisions] summary", error.message);
    return {};
  }
  const out: Record<string, StepRevisionSummary> = {};
  const seenOriginal = new Set<string>();
  for (const r of data ?? []) {
    const summary = (out[r.step_id] ??= { count: 0, originalDate: null });
    const key = `${r.step_id}:${r.kind}`;
    if (r.kind !== "completed_on" && !seenOriginal.has(key)) {
      seenOriginal.add(key);
      summary.originalDate ??= r.new_date;
      continue;
    }
    summary.count += 1;
  }
  return out;
}
