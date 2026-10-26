import "server-only";

import { allBatchesInPreLoading, hasStepPlan } from "@/lib/checklist-completion";
import { formatDateNumeric, todayIso } from "@/lib/format";
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
 *  - **Balance Payment** (22/10/2026): igual ao Deposit, com o "Balance date".
 *  - **Place the Order** (22/10/2026): conclui quando TODAS as fábricas do
 *    pedido têm a data "Placed on"; trocar uma data exige motivo (History).
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

type StepRow = {
  id: string;
  step: ChecklistStep;
  completed_on: string | null;
  estimated_date: string | null;
  responsible_id: string | null;
};

/** O mínimo que concluir/reabrir precisa. */
type TriggerStep = Pick<StepRow, "id" | "step" | "completed_on">;

async function readStep(admin: Admin, orderId: string, step: ChecklistStep): Promise<StepRow | null> {
  const { data, error } = await admin
    .from("order_checklist_steps")
    .select("id, step, completed_on, estimated_date, responsible_id")
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
 *
 * Sem Estimated date + Responsible a etapa não fecha (26/10/2026, vale para
 * todas): o dado do gatilho fica gravado e ela fecha quando os dois forem
 * preenchidos (recheckPlanStep); se já estava concluída, reabre.
 */
async function completeByTrigger(
  admin: Admin,
  step: StepRow,
  completedOn: string,
  userId: string | null
): Promise<void> {
  if (!hasStepPlan(step)) {
    if (step.completed_on) await reopenByTrigger(admin, step, userId);
    return;
  }
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

/** Apaga o Completed on (e o Signed by) quando o gatilho deixou de valer. */
async function reopenByTrigger(admin: Admin, step: TriggerStep, userId: string | null): Promise<void> {
  const { error } = await admin
    .from("order_checklist_steps")
    .update({ completed_on: null, done: false, signed_by_id: null })
    .eq("id", step.id);
  if (error) throw new Error(error.message);
  await writeStepLog(admin, {
    owner: { checklistStepId: step.id },
    step: step.step,
    action: "update",
    changes: { completed_on: { from: step.completed_on, to: null } },
    userId,
    gssWhenNoUser: true,
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

// ── Deposit Payment / Balance Payment ────────────────────────────────────────

/** As datas de pagamento que concluem etapa: coluna em `orders` → etapa + rótulo. */
const PAYMENT_DATES = {
  deposit_date: { step: "deposit_payment", label: "deposit date" },
  balance_date: { step: "balance_payment", label: "balance date" },
} as const satisfies Record<string, { step: ChecklistStep; label: string }>;

type PaymentDateField = keyof typeof PAYMENT_DATES;

/**
 * Grava uma data de pagamento da Order — o "Deposit date" (Deposit Payment, card
 * do cliente, 20/10/2026) ou o "Balance date" (Balance Payment, igual ao Deposit
 * desde 22/10/2026): a data em que o cliente pagou de fato. MOTIVO é obrigatório
 * em TODA gravação, inclusive a 1ª (decisão do usuário; difere do Order received
 * date, cujo 1º registro é livre).
 *
 * Cada gravação regrava o Completed on com o DIA DA GRAVAÇÃO, não a data do
 * pagamento (a última atualização, imutável). Retorna a mensagem de erro de
 * validação, ou null.
 */
async function setPaymentDate(
  admin: Admin,
  orderId: string,
  field: PaymentDateField,
  date: string,
  who: Who
): Promise<string | null> {
  const { step: stepKey, label } = PAYMENT_DATES[field];
  if (date > todayIso()) return `The ${label} can't be in the future.`;

  const { data: order, error } = await admin
    .from("orders")
    .select("deposit_date, balance_date")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) return "Order not found.";

  const previous = order[field];
  if (previous === date) return null;

  const reason = reasonFor(who);
  if (!reason) return `A reason is required to record the ${label}.`;

  const step = await readStep(admin, orderId, stepKey);
  if (!step) return "Checklist step not found.";

  const { error: upError } = await admin
    .from("orders")
    .update(field === "deposit_date" ? { deposit_date: date } : { balance_date: date })
    .eq("id", orderId);
  if (upError) throw new Error(upError.message);

  await insertRevision(
    admin,
    {
      order_id: orderId,
      step_id: step.id,
      kind: field,
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
    changes: { [field]: { from: previous, to: date }, reason },
    userId: who.userId,
  });

  // Completed on = o MOMENTO da última gravação (não a data do pagamento).
  await completeByTrigger(admin, step, todayIso(), who.userId);
  return null;
}

/** "Deposit date" da etapa Deposit Payment (ver `setPaymentDate`). */
export function setDepositDate(admin: Admin, orderId: string, date: string, who: Who) {
  return setPaymentDate(admin, orderId, "deposit_date", date, who);
}

/** "Balance date" da etapa Balance Payment (ver `setPaymentDate`). */
export function setBalanceDate(admin: Admin, orderId: string, date: string, who: Who) {
  return setPaymentDate(admin, orderId, "balance_date", date, who);
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

    // Cada leva que muda o conjunto regrava o Completed on (a última atualização);
    // leva que zera as F×C reabre o PO (23/10/2026).
    if (items.length > 0) await completeByTrigger(admin, step, today, who.userId);
    else if (step.completed_on) await reopenByTrigger(admin, step, who.userId);

    // Fábrica/entrada nova sem data reabre Place the Order e ETD.
    await recheckFactorySteps(admin, orderId, who.userId);
  } catch (err) {
    console.error("[checklist-revisions] fxc", err instanceof Error ? err.message : err);
  }
}

// ── Place the Order ──────────────────────────────────────────────────────────

/**
 * Place the Order (22/10/2026 — antes era o anexo por fábrica): cada fábrica da
 * Order ganha a sua data "Placed on", informada pelo usuário
 * (`order_factory_placed_dates`). A 1ª gravação é livre; trocar depois exige
 * motivo (vai pro History da etapa, como o Order received date). Nunca futura.
 *
 * A etapa conclui quando TODAS as fábricas ativas da Order têm data; daí em
 * diante, cada data gravada regrava o Completed on com o dia (a última
 * atualização, imutável). O anexo por fábrica segue opcional e não conta mais.
 * Retorna a mensagem de erro de validação, ou null.
 */
export async function setFactoryPlacedDate(
  admin: Admin,
  orderId: string,
  factoryId: string,
  date: string,
  who: Who
): Promise<string | null> {
  if (!date) return "Choose the placed-on date.";
  if (date > todayIso()) return "The placed-on date can't be in the future.";

  const [{ data: lines, error: lError }, { data: existing, error: eError }, { data: factory }] =
    await Promise.all([
      admin
        .from("order_factory_category")
        .select("factory_id")
        .eq("order_id", orderId)
        .eq("is_active", true),
      admin
        .from("order_factory_placed_dates")
        .select("id, placed_on")
        .eq("order_id", orderId)
        .eq("factory_id", factoryId)
        .maybeSingle(),
      admin.from("factories").select("name").eq("id", factoryId).maybeSingle(),
    ]);
  if (lError) throw new Error(lError.message);
  if (eError) throw new Error(eError.message);
  if (!(lines ?? []).some((l) => l.factory_id === factoryId)) {
    return "This factory is not in the order.";
  }

  const previous = existing?.placed_on ?? null;
  if (previous === date) return null;
  const reason = reasonFor(who);
  if (previous && !reason) return "A reason is required to revise the placed-on date.";

  const step = await readStep(admin, orderId, "place_the_order");
  if (!step) return "Checklist step not found.";

  const { error } = await admin.from("order_factory_placed_dates").upsert(
    {
      order_id: orderId,
      factory_id: factoryId,
      placed_on: date,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "order_id,factory_id" }
  );
  if (error) throw new Error(error.message);

  // History da etapa: "Fábrica: dd/mm/yyyy" (a etapa tem uma data por fábrica).
  const label = factory?.name ?? "Factory";
  await writeStepLog(admin, {
    owner: { checklistStepId: step.id },
    step: step.step,
    action: "update",
    changes: {
      placed_on: {
        from: previous ? `${label}: ${formatDateNumeric(previous)}` : null,
        to: `${label}: ${formatDateNumeric(date)}`,
      },
      ...(previous && reason ? { reason } : {}),
    },
    userId: who.userId,
  });

  const factoryIds = new Set((lines ?? []).map((l) => l.factory_id));
  const { data: dated, error: dError } = await admin
    .from("order_factory_placed_dates")
    .select("factory_id")
    .eq("order_id", orderId);
  if (dError) throw new Error(dError.message);
  const datedIds = new Set((dated ?? []).map((d) => d.factory_id));
  if ([...factoryIds].every((f) => datedIds.has(f))) {
    await completeByTrigger(admin, step, todayIso(), who.userId);
  }
  return null;
}

/**
 * Place the Order e ETD concluídas cuja condição deixou de valer (23/10/2026):
 * chegou fábrica sem "Placed on" ou entrada Factory × Category sem "Initial
 * Date" → apaga o Completed on e o Signed by. Chamada depois de cada leva de
 * F×C (`recordFxcDelivery`). Só reabre — concluir segue com os gatilhos de cada
 * etapa.
 */
async function recheckFactorySteps(admin: Admin, orderId: string, userId: string | null) {
  const [placeStep, etdStep] = await Promise.all([
    readStep(admin, orderId, "place_the_order"),
    readStep(admin, orderId, "etd"),
  ]);
  if (!placeStep?.completed_on && !etdStep?.completed_on) return;

  const { data: lines, error } = await admin
    .from("order_factory_category")
    .select("id, factory_id")
    .eq("order_id", orderId)
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  const active = lines ?? [];

  if (placeStep?.completed_on) {
    const { data: dated, error: dError } = await admin
      .from("order_factory_placed_dates")
      .select("factory_id")
      .eq("order_id", orderId);
    if (dError) throw new Error(dError.message);
    const datedIds = new Set((dated ?? []).map((d) => d.factory_id));
    if (active.length === 0 || active.some((l) => !datedIds.has(l.factory_id))) {
      await reopenByTrigger(admin, placeStep, userId);
    }
  }

  if (etdStep?.completed_on) {
    const { data: etds, error: eError } = active.length
      ? await admin
          .from("etd_info")
          .select("order_factory_category_id")
          .in("order_factory_category_id", active.map((l) => l.id))
          .not("initial_date", "is", null)
      : { data: [], error: null };
    if (eError) throw new Error(eError.message);
    if (active.length === 0 || (etds ?? []).length < active.length) {
      await reopenByTrigger(admin, etdStep, userId);
    }
  }
}

// ── Pre-Loading (etapa da Order) ─────────────────────────────────────────────

/**
 * Pre-Loading da Order (22/10/2026): conclui quando TODOS os lotes da Order
 * (fora os cancelados) estão em Pre-Loading ou adiante. Chamada quando lotes
 * entram ou saem de um PL (domain/pre-loadings/write `syncPreLoadingRelations`
 * e a exclusão do PL) — cada lote que entra num PL é atualização da etapa,
 * então, com a condição cumprida, o Completed on vira o dia dela (a última
 * atualização). Quando a condição deixa de valer — lote que sai do PL, lote
 * novo da Order fora de PL, lote que volta de fase — a etapa perde o Completed
 * on e o Signed by (usuário, 23/10/2026). `reopenOnly` (chamada pelo rollup
 * do status da Order, lib/order-status, por onde passa toda escrita de status
 * de lote) só reabre: não conclui nem regrava o Completed on.
 */
export async function syncOrderPreLoadingStep(
  admin: Admin,
  orderIds: string[],
  userId: string | null,
  { reopenOnly = false }: { reopenOnly?: boolean } = {}
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
    const ready = (orderId: string) => allBatchesInPreLoading(byOrder.get(orderId) ?? []);
    const targets = reopenOnly ? ids.filter((id) => !ready(id)) : ids;
    if (targets.length === 0) return;

    const { data: steps, error: stepsError } = await admin
      .from("order_checklist_steps")
      .select("id, step, completed_on, estimated_date, responsible_id, order_id")
      .eq("step", "pre_loading")
      .in("order_id", targets);
    if (stepsError) throw new Error(stepsError.message);

    for (const { order_id, ...step } of steps ?? []) {
      if (ready(order_id)) await completeByTrigger(admin, step, todayIso(), userId);
      else if (step.completed_on) await reopenByTrigger(admin, step, userId);
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

/**
 * Etapa da Order depois de mexerem no Estimated date ou no Responsible
 * (26/10/2026, vale para todas): faltou um dos dois → etapa concluída reabre; os
 * dois preenchidos e o gatilho já cumprido → fecha com Completed on = hoje.
 * Etapa já concluída que segue valendo fica como está — trocar previsão ou
 * responsável não é atualização do dado. Etapa de Completed on manual
 * (Condition Confirm) só reabre; concluir segue sendo à mão.
 */
export async function recheckPlanStep(
  admin: Admin,
  orderId: string,
  stepKey: ChecklistStep,
  userId: string | null
): Promise<void> {
  const step = await readStep(admin, orderId, stepKey);
  if (!step) return;

  if (!hasStepPlan(step)) {
    if (step.completed_on) await reopenByTrigger(admin, step, userId);
    return;
  }
  if (step.completed_on) return;

  if (await triggerFulfilled(admin, orderId, stepKey)) {
    await completeByTrigger(admin, step, todayIso(), userId);
  }
}

/** O gatilho da etapa já foi cumprido (o dado que conclui está lá)? */
async function triggerFulfilled(admin: Admin, orderId: string, step: ChecklistStep): Promise<boolean> {
  switch (step) {
    case "order":
    case "pi":
    case "deposit_payment":
    case "balance_payment": {
      const { data, error } = await admin
        .from("orders")
        .select("order_received_date, pi_status, deposit_date, balance_date")
        .eq("id", orderId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return false;
      if (step === "order") return !!data.order_received_date;
      if (step === "pi") return data.pi_status === true;
      if (step === "deposit_payment") return !!data.deposit_date;
      return !!data.balance_date;
    }
    case "po":
    case "place_the_order":
    case "etd": {
      const { data: lines, error } = await admin
        .from("order_factory_category")
        .select("id, factory_id")
        .eq("order_id", orderId)
        .eq("is_active", true);
      if (error) throw new Error(error.message);
      const active = lines ?? [];
      if (active.length === 0) return false;
      if (step === "po") return true;
      if (step === "place_the_order") {
        const { data: dated, error: dError } = await admin
          .from("order_factory_placed_dates")
          .select("factory_id")
          .eq("order_id", orderId);
        if (dError) throw new Error(dError.message);
        const datedIds = new Set((dated ?? []).map((d) => d.factory_id));
        return active.every((l) => datedIds.has(l.factory_id));
      }
      const { data: etds, error: eError } = await admin
        .from("etd_info")
        .select("order_factory_category_id")
        .in("order_factory_category_id", active.map((l) => l.id))
        .not("initial_date", "is", null);
      if (eError) throw new Error(eError.message);
      return (etds ?? []).length >= active.length;
    }
    case "pre_loading": {
      const { data: batches, error } = await admin
        .from("batches")
        .select("status")
        .eq("order_id", orderId)
        .neq("status", "canceled");
      if (error) throw new Error(error.message);
      return allBatchesInPreLoading((batches ?? []).map((b) => b.status));
    }
    default:
      // Completed on digitado (Condition Confirm e as ocultas): não fecha sozinha.
      return false;
  }
}

// ── PI ───────────────────────────────────────────────────────────────────────

/**
 * Status da PI vindo do GSS (boolean, 22/10/2026) + data. `true` conclui a PI
 * com Completed on = a data do status; `false` só grava (histórico) — não
 * conclui nem reabre. A 1ª gravação é o registro original, as seguintes viram
 * revisões. Mesmo status e mesma data de novo → nada.
 */
export async function recordPiStatus(
  admin: Admin,
  orderId: string,
  status: boolean,
  date: string,
  who: Who
): Promise<string | null> {
  const clean = status;

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

  const first = order.pi_status === null && !order.pi_status_date;
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

  // PI não emitida: fica no histórico e a etapa não conclui — já concluída,
  // reabre (23/10/2026).
  if (!clean) {
    if (step.completed_on) await reopenByTrigger(admin, step, who.userId);
    return null;
  }
  // Cada `true` novo regrava o Completed on com a data dele (a última
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
