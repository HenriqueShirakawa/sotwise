import "server-only";

import { todayIso } from "@/lib/format";
import { writeStepLog } from "@/lib/checklist-step-log";
import type { createAdminClient } from "@/lib/supabase/admin";
import type {
  ChecklistRevisionKind,
  ChecklistRevisionSource,
  ChecklistStep,
} from "@/types/database";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Etapas Order / PO / PI do checklist — gatilho próprio + revisões (20/10/2026,
 * planilha "checklistregras", docs §3.7.5):
 *
 *  - **Order**: o usuário grava o "Order received date" (data do pedido final do
 *    cliente). A 1ª gravação conclui a etapa com Completed on = HOJE; cada troca
 *    depois exige motivo e vira revisão.
 *  - **PO**: conclui quando as Factory × Category chegam do GSS. Cada leva que
 *    muda o conjunto de F×C ativas é registrada (lista + o que mudou).
 *  - **PI**: o GSS manda o status da PI (texto livre) + data. O 1º status conclui
 *    a etapa com Completed on = data dele; os seguintes são revisões.
 *
 * A 1ª linha de cada tipo (`order_received_date`, `fxc`, `pi_status`) é o
 * registro ORIGINAL — nunca se perde. Revisões = as linhas depois dela, mais as
 * correções manuais de Completed on (`completed_on`) no PO/PI.
 *
 * Gatilho nunca REABRE etapa nem sobrescreve Completed on já preenchido: etapa
 * migrada do Bubble (ou concluída à mão) fica como está.
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
 * Conclui a etapa pelo gatilho — só se ainda está aberta. Signed by = quem fez
 * (null quando veio do GSS).
 */
async function completeByTrigger(
  admin: Admin,
  step: StepRow,
  completedOn: string,
  userId: string | null
): Promise<void> {
  if (step.completed_on) return;
  const { error } = await admin
    .from("order_checklist_steps")
    .update({ completed_on: completedOn, done: true, signed_by_id: userId })
    .eq("id", step.id);
  if (error) throw new Error(error.message);
  await writeStepLog(admin, {
    owner: { checklistStepId: step.id },
    step: step.step,
    action: "auto_complete",
    changes: { completed_on: { from: null, to: completedOn } },
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

  // Completed on = o MOMENTO em que a data foi informada (não a data em si).
  if (!previous) await completeByTrigger(admin, step, todayIso(), who.userId);
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

    if (!previous) await completeByTrigger(admin, step, today, who.userId);
  } catch (err) {
    console.error("[checklist-revisions] fxc", err instanceof Error ? err.message : err);
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

  // Completed on nunca é futuro: status com data adiante conclui com hoje.
  if (first) {
    const today = todayIso();
    await completeByTrigger(admin, step, date > today ? today : date, who.userId);
  }
  return null;
}

// ── Correção manual de Completed on (PO / PI) ───────────────────────────────

/**
 * PO e PI seguem com Completed on editável como saída manual. O 1º preenchimento
 * é livre (vai pelo updateChecklistStep); TROCAR uma data já gravada passa por
 * aqui — motivo obrigatório, vira revisão.
 */
export async function reviseCompletedOn(
  admin: Admin,
  stepId: string,
  date: string,
  reason: string,
  userId: string
): Promise<string | null> {
  if (date > todayIso()) return "The completion date can't be in the future.";
  if (!reason.trim()) return "A reason is required to revise the completion date.";

  const { data: step, error } = await admin
    .from("order_checklist_steps")
    .select("id, order_id, step, completed_on")
    .eq("id", stepId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!step) return "Checklist step not found.";
  if (step.step !== "po" && step.step !== "pi") return "This step can't be revised here.";
  if (step.completed_on === date) return null;

  const { error: upError } = await admin
    .from("order_checklist_steps")
    .update({ completed_on: date, done: true, signed_by_id: userId })
    .eq("id", stepId);
  if (upError) throw new Error(upError.message);

  await insertRevision(
    admin,
    {
      order_id: step.order_id,
      step_id: stepId,
      kind: "completed_on",
      previous_date: step.completed_on,
      new_date: date,
      reason: reason.trim(),
    },
    { source: "manual", userId }
  );
  await writeStepLog(admin, {
    owner: { checklistStepId: stepId },
    step: step.step,
    action: "update",
    changes: { completed_on: { from: step.completed_on, to: date } },
    userId,
  });
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
