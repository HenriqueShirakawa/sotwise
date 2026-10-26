import "server-only";

import { EVENT_DATE_ALLOWS_FUTURE, EVENT_DATE_STEPS } from "@/lib/checklist";
import { hasStepPlan } from "@/lib/checklist-completion";
import { writeStepLog } from "@/lib/checklist-step-log";
import { todayIso } from "@/lib/format";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { ChecklistStep } from "@/types/database";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Grava a data do fato de Shipping Date / ETA / ATA / Delivered (21/10/2026,
 * planilha de regras do checklist — mesmo molde do "Order received date" em
 * lib/checklist-revisions):
 *
 *  - 1ª gravação: conclui a etapa — Completed on = o DIA DA GRAVAÇÃO (não a data
 *    informada), Signed by = quem gravou.
 *  - Depois: trocar a data exige motivo; o de → para e o motivo vão pro History
 *    da etapa, e o Completed on vira o dia dessa troca (22/10/2026: Completed on
 *    = a ÚLTIMA atualização, imutável — ninguém edita à mão).
 *
 * Etapa já concluída antes (migrada) e sem data do fato: a 1ª gravação é livre.
 *
 * `completed` = a gravação concluiu a etapa agora (quem chama aplica o efeito do
 * Delivered — lotes e embarque entregues). Erro de validação vem em `error`.
 */
export async function setPlStepEventDate(
  admin: Admin,
  preLoadingId: string,
  step: ChecklistStep,
  date: string,
  who: { userId: string | null; reason?: string | null }
): Promise<{ error: string | null; completed: boolean }> {
  const label = EVENT_DATE_STEPS[step];
  if (!label) return { error: "This step has no date of its own.", completed: false };
  if (!date) return { error: `Choose the ${label.toLowerCase()}.`, completed: false };
  if (date > todayIso() && !EVENT_DATE_ALLOWS_FUTURE.has(step)) {
    return { error: `The ${label.toLowerCase()} can't be in the future.`, completed: false };
  }

  const { data: existing, error: readError } = await admin
    .from("pre_loading_checklist_steps")
    .select("id, event_date, completed_on, signed_by_id, estimated_date, responsible_id")
    .eq("pre_loading_id", preLoadingId)
    .eq("step", step)
    .maybeSingle();
  if (readError) return { error: readError.message, completed: false };
  // Sem Estimated date + Responsible a data é gravada mas a etapa não fecha
  // (26/10/2026, vale para todas); já concluída, reabre — menos o Delivered,
  // que entregou lotes e embarque e não volta por aqui.
  const plan = !!existing && hasStepPlan(existing);

  const previous = existing?.event_date ?? null;
  if (previous === date) return { error: null, completed: false };

  const reason = who.reason?.trim() || null;
  if (previous && !reason) {
    return { error: `A reason is required to revise the ${label.toLowerCase()}.`, completed: false };
  }

  const today = todayIso();
  const reopen = !plan && !!existing?.completed_on && step !== "delivered";
  const completing = plan && !existing?.completed_on;
  const values = plan
    ? { event_date: date, completed_on: today, done: true, signed_by_id: who.userId }
    : reopen
      ? { event_date: date, completed_on: null, done: false, signed_by_id: null }
      : { event_date: date };
  const after = {
    completed_on: "completed_on" in values ? values.completed_on : (existing?.completed_on ?? null),
    signed_by_id: "signed_by_id" in values ? values.signed_by_id : (existing?.signed_by_id ?? null),
  };

  const { data: saved, error } = existing
    ? await admin
        .from("pre_loading_checklist_steps")
        .update(values)
        .eq("id", existing.id)
        .select("id")
        .single()
    : await admin
        .from("pre_loading_checklist_steps")
        .insert({ pre_loading_id: preLoadingId, step, ...values })
        .select("id")
        .single();
  if (error || !saved) return { error: error?.message ?? "Could not save the date.", completed: false };

  await writeStepLog(admin, {
    owner: { preLoadingStepId: saved.id },
    step,
    action: "update",
    changes: {
      event_date: { from: previous, to: date },
      ...((existing?.completed_on ?? null) !== after.completed_on
        ? { completed_on: { from: existing?.completed_on ?? null, to: after.completed_on } }
        : {}),
      ...((existing?.signed_by_id ?? null) !== after.signed_by_id
        ? { signed_by_id: { from: existing?.signed_by_id ?? null, to: after.signed_by_id } }
        : {}),
      ...(previous && reason ? { reason } : {}),
    },
    userId: who.userId,
  });

  return { error: null, completed: completing };
}
