import "server-only";

import { hasExtraRequirements, isStepChecked, plStepFacts } from "@/lib/checklist-completion";
import { writeStepLog } from "@/lib/checklist-step-log";
import { loadPlClientState, perClientOf } from "@/lib/pl-clients";
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
 *  - ela tem exigência extra — etapa que só pede a data (Loading Date…) não
 *    passa por aqui;
 *  - existe "Estimated date" — a mesma trava de `validateStepDates`: não se
 *    conclui etapa que nunca foi prevista;
 *  - a etapa ainda não tem "Completed on" OU `refresh` (22/10/2026: Completed on
 *    = a ÚLTIMA atualização) — quem chama passa `refresh` quando o usuário acabou
 *    de mudar um dado da etapa (cadastro, booking, documento novo) e a etapa,
 *    já concluída, ganha o Completed on de hoje. Só mexer no Estimated date não
 *    é atualização da etapa.
 *
 * Ninguém edita o Completed on à mão (nem o admin), e ele nunca é limpo por
 * aqui: a etapa não reabre. Devolve true se gravou, pra quem chamou revalidar.
 */
export async function autoCompletePlStep(
  admin: Admin,
  preLoadingId: string,
  step: ChecklistStep,
  userId: string | null,
  { refresh = false }: { refresh?: boolean } = {}
): Promise<boolean> {
  if (!hasExtraRequirements(step)) return false;

  const { data: s } = await admin
    .from("pre_loading_checklist_steps")
    .select(
      "id, estimated_date, completed_on, signed_by_id, consolidation_point_id, city_id, pol_id, carrier_id, agent_brazil_id, agent_china_id, contact_brazil_id, contact_china_id, booking_number, cutoff_date, doc_cutoff_date, event_date"
    )
    .eq("pre_loading_id", preLoadingId)
    .eq("step", step)
    .maybeSingle();
  if (!s) return false;
  if (s.completed_on ? !refresh : !s.estimated_date) return false;

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

  // Shipping Docs / Booking em PL com 2+ clientes: só fecha com TODOS cobertos.
  const perClient =
    step === "shipping_docs" || step === "booking"
      ? perClientOf(await loadPlClientState(admin, preLoadingId))
      : undefined;

  const today = todayIso();
  const facts = plStepFacts(
    { ...s, completed_on: today },
    attachments ?? 0,
    contactCountByAgent,
    perClient
  );
  // Incompleta depois da mudança (ex.: agente trocado sem contato): não fecha e,
  // se já estava concluída, não reabre — fica como está.
  if (!isStepChecked(step, facts)) return false;
  if (s.completed_on === today && s.signed_by_id === userId) return false;

  const { error } = await admin
    .from("pre_loading_checklist_steps")
    .update({ completed_on: today, done: true, signed_by_id: userId })
    .eq("id", s.id);
  if (error) return false;

  // Fechou (ou foi atualizada) por consequência do que o usuário acabou de
  // preencher — entra no log como ação dele, marcada como automática.
  await writeStepLog(admin, {
    owner: { preLoadingStepId: s.id },
    step,
    action: "auto_complete",
    changes: {
      ...(s.completed_on !== today ? { completed_on: { from: s.completed_on, to: today } } : {}),
      ...(s.signed_by_id !== userId ? { signed_by_id: { from: s.signed_by_id, to: userId } } : {}),
    },
    userId,
  });
  return true;
}
