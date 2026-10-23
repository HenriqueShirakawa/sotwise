import "server-only";

import { hasExtraRequirements, isStepChecked, plStepFacts } from "@/lib/checklist-completion";
import { writeStepLog } from "@/lib/checklist-step-log";
import { loadPlClientState, perClientOf } from "@/lib/pl-clients";
import { todayIso } from "@/lib/format";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { ChecklistStep } from "@/types/database";

type Admin = ReturnType<typeof createAdminClient>;

const PER_CLIENT_AUTOCOMPLETE: ReadonlySet<ChecklistStep> = new Set<ChecklistStep>([
  "shipping_docs",
  "booking",
  "bl",
  "original_docs",
]);

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
 * Ninguém edita o Completed on à mão (nem o admin). Reabre (23/10/2026, pedido
 * do usuário): com `refresh` ou `recheck` (só reavalia, sem regravar o Completed
 * on — lotes que entram/saem do PL mudam os clientes), etapa concluída cuja
 * condição deixou de valer (cadastro apagado, documento removido, cliente novo
 * no PL…) perde o Completed on e o Signed by, com registro no History. A condição é julgada pela data de
 * conclusão que a etapa tem — etapa concluída antes de uma regra nova
 * (BOOKING_CUTOFFS_REQUIRED_FROM, SHIPMENT_PER_CLIENT_FROM) segue pela regra
 * antiga. Delivered não reabre por aqui: reabrir devolveria lotes e embarque a
 * In Transit (applyDeliveredRule), e a data dela não se apaga.
 * Devolve true se gravou, pra quem chamou revalidar.
 */
export async function autoCompletePlStep(
  admin: Admin,
  preLoadingId: string,
  step: ChecklistStep,
  userId: string | null,
  { refresh = false, recheck = false }: { refresh?: boolean; recheck?: boolean } = {}
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
  if (s.completed_on ? !(refresh || recheck) : !s.estimated_date) return false;

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

  // Etapas por cliente (Shipping Docs, Booking, BL, Original Docs): só fecha com
  // TODOS os clientes cobertos.
  const perClient = PER_CLIENT_AUTOCOMPLETE.has(step)
    ? perClientOf(await loadPlClientState(admin, preLoadingId))
    : undefined;

  // Concluída e a condição deixou de valer (ex.: agente trocado sem contato,
  // documento removido): reabre.
  if (
    s.completed_on &&
    step !== "delivered" &&
    !isStepChecked(step, plStepFacts(s, attachments ?? 0, contactCountByAgent, perClient))
  ) {
    const { error } = await admin
      .from("pre_loading_checklist_steps")
      .update({ completed_on: null, done: false, signed_by_id: null })
      .eq("id", s.id);
    if (error) return false;
    await writeStepLog(admin, {
      owner: { preLoadingStepId: s.id },
      step,
      action: "update",
      changes: {
        completed_on: { from: s.completed_on, to: null },
        ...(s.signed_by_id ? { signed_by_id: { from: s.signed_by_id, to: null } } : {}),
      },
      userId,
    });
    return true;
  }

  // `recheck` só reabre: etapa concluída que segue valendo fica como está.
  if (s.completed_on && !refresh) return false;

  const today = todayIso();
  const facts = plStepFacts(
    { ...s, completed_on: today },
    attachments ?? 0,
    contactCountByAgent,
    perClient
  );
  // Incompleta depois da mudança: não fecha (concluída só reabre acima, pela
  // regra da data que ela tem).
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
