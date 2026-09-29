import "server-only";

import { hasExtraRequirements, isStepChecked, plStepFacts } from "@/lib/checklist-completion";
import { todayIso } from "@/lib/format";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { ChecklistStep } from "@/types/database";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Auto-conclusão das etapas do checklist do PL/Shipment (QA 28/09, PL4): a etapa
 * que exige algo além da data (cadastro escolhido, documento, booking number —
 * ver lib/checklist-completion) fecha sozinha assim que TUDO isso está
 * preenchido: grava "Completed on" = hoje e "Signed by" = quem completou.
 *
 * Só age quando:
 *  - a etapa ainda não tem "Completed on" (nunca sobrescreve data já posta);
 *  - ela tem exigência extra — etapa que só pede a data (Loading Date, ETA…)
 *    continua manual, senão fecharia no primeiro clique;
 *  - existe "Estimated date" — a mesma trava de `validateStepDates`: não se
 *    conclui etapa que nunca foi prevista.
 *
 * A data continua editável depois (a real pode ser outra). Devolve true se
 * concluiu, pra quem chamou revalidar o que depende disso.
 */
export async function autoCompletePlStep(
  admin: Admin,
  preLoadingId: string,
  step: ChecklistStep,
  userId: string
): Promise<boolean> {
  if (!hasExtraRequirements(step, { completedOn: null })) return false;

  const { data: s } = await admin
    .from("pre_loading_checklist_steps")
    .select(
      "id, estimated_date, completed_on, consolidation_point_id, city_id, pol_id, carrier_id, agent_brazil_id, agent_china_id, contact_brazil_id, contact_china_id, booking_number"
    )
    .eq("pre_loading_id", preLoadingId)
    .eq("step", step)
    .maybeSingle();
  if (!s || s.completed_on || !s.estimated_date) return false;

  const { count: attachments } = await admin
    .from("step_attachments")
    .select("id", { count: "exact", head: true })
    .eq("pre_loading_step_id", s.id);

  // Agents: contato só é exigido quando o agente escolhido tem contato cadastrado.
  const agentIds = [s.agent_brazil_id, s.agent_china_id].filter((id): id is string => !!id);
  const contactCountByAgent: Record<string, number> = {};
  if (step === "agents" && agentIds.length) {
    const { data: contacts } = await admin
      .from("agent_contacts")
      .select("agent_id")
      .in("agent_id", agentIds);
    for (const c of contacts ?? []) {
      contactCountByAgent[c.agent_id] = (contactCountByAgent[c.agent_id] ?? 0) + 1;
    }
  }

  const today = todayIso();
  const facts = plStepFacts({ ...s, completed_on: today }, attachments ?? 0, contactCountByAgent);
  if (!isStepChecked(step, facts)) return false;

  // `.is(completed_on, null)`: se alguém concluiu à mão no meio tempo, não pisa.
  const { data: updated } = await admin
    .from("pre_loading_checklist_steps")
    .update({ completed_on: today, done: true, signed_by_id: userId })
    .eq("id", s.id)
    .is("completed_on", null)
    .select("id");
  return (updated?.length ?? 0) > 0;
}
