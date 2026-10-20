import "server-only";

import { LOCKED_COMPLETED_ON_STEPS } from "@/lib/checklist-completion";
import { writeStepLog } from "@/lib/checklist-step-log";
import { todayIso } from "@/lib/format";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { ChecklistStep } from "@/types/database";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Correção do "Completed on" travado de uma etapa do PL/Shipment (20/10/2026).
 * As etapas de LOCKED_COMPLETED_ON_STEPS fecham sozinhas (lib/pl-step-autocomplete);
 * a tela não deixa ninguém mexer na data, só o admin/owner corrige — com motivo,
 * que fica no History da etapa (`checklist_step_log`, `changes.reason`).
 *
 * `date` null reabre a etapa (ex.: documento removido depois de ela fechar).
 * Quem chama garante que é admin/owner. Retorna a mensagem de erro, ou null.
 */
export async function correctPlStepCompletedOn(
  admin: Admin,
  preLoadingId: string,
  step: ChecklistStep,
  date: string | null,
  reason: string,
  userId: string
): Promise<string | null> {
  if (!LOCKED_COMPLETED_ON_STEPS.has(step)) return "This step is completed manually.";
  if (!reason.trim()) return "A reason is required to correct the completion date.";
  if (date && date > todayIso()) return "The completion date can't be in the future.";

  const { data: current, error: readError } = await admin
    .from("pre_loading_checklist_steps")
    .select("id, completed_on, signed_by_id")
    .eq("pre_loading_id", preLoadingId)
    .eq("step", step)
    .maybeSingle();
  if (readError) return readError.message;
  if (!current) return "Checklist step not found.";
  if (current.completed_on === date) return null;

  const signedBy = date ? userId : null;
  const { error } = await admin
    .from("pre_loading_checklist_steps")
    .update({ completed_on: date, done: date != null, signed_by_id: signedBy })
    .eq("id", current.id);
  if (error) return error.message;

  await writeStepLog(admin, {
    owner: { preLoadingStepId: current.id },
    step,
    action: "update",
    changes: {
      completed_on: { from: current.completed_on, to: date },
      ...(current.signed_by_id !== signedBy
        ? { signed_by_id: { from: current.signed_by_id, to: signedBy } }
        : {}),
      reason: reason.trim(),
    },
    userId,
  });
  return null;
}
