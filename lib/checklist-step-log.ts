import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import type { ChecklistStep, ChecklistStepLogAction } from "@/types/database";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Log de alterações das etapas do checklist (`checklist_step_log`, 20/10/2026).
 * Toda alteração que um USUÁRIO faz numa etapa — nas 3 telas — vira uma linha:
 * quem, quando e só o diff. Gravado pelas server actions (o mesmo padrão do
 * `etd_history`), não por trigger: a integração com o GSS e os scripts também
 * escrevem nas etapas e não devem entrar no log.
 *
 * Falha ao gravar o log não desfaz a alteração (já foi salva) — só vai pro
 * console, como os outros efeitos colaterais das actions.
 */

/** Colunas das etapas que entram no log. `done` fica de fora: é espelho de
 *  `completed_on`. */
export const STEP_LOG_FIELDS = [
  "enabled",
  "estimated_date",
  "responsible_id",
  "completed_on",
  "signed_by_id",
  "notes",
  "consolidation_point_id",
  "city_id",
  "pol_id",
  "carrier_id",
  "agent_brazil_id",
  "agent_china_id",
  "contact_brazil_id",
  "contact_china_id",
  "booking_number",
  "cutoff_date",
  "doc_cutoff_date",
] as const;

/** O que ler de `pre_loading_checklist_steps` antes de gravar, pro diff (a
 *  tabela do PL não tem `enabled` — só a de Order). */
export const PL_STEP_LOG_COLUMNS =
  "id, estimated_date, responsible_id, completed_on, signed_by_id, notes, consolidation_point_id, city_id, pol_id, carrier_id, agent_brazil_id, agent_china_id, contact_brazil_id, contact_china_id, booking_number, cutoff_date, doc_cutoff_date" as const;

export type StepLogField = (typeof STEP_LOG_FIELDS)[number];
export type StepLogChanges = Partial<Record<StepLogField, { from: unknown; to: unknown }>>;

/** Dono da linha: etapa de Order ou etapa do checklist único do PL/Shipment. */
export type StepLogOwner = { checklistStepId: string } | { preLoadingStepId: string };

/**
 * Diff entre o estado anterior da etapa (`before`, null = linha ainda não
 * existia) e o que foi gravado (`written`). Só olha as colunas do log.
 */
export function diffStepFields(
  before: Record<string, unknown> | null,
  written: Record<string, unknown>
): StepLogChanges {
  const changes: StepLogChanges = {};
  for (const field of STEP_LOG_FIELDS) {
    if (!(field in written)) continue;
    const from = before?.[field] ?? null;
    const to = written[field] ?? null;
    if (from !== to) changes[field] = { from, to };
  }
  return changes;
}

/**
 * Etapa + nome do arquivo de um anexo, lidos ANTES de apagá-lo — depois do
 * delete não há mais de onde tirar. Serve às duas origens.
 */
export async function readAttachmentForLog(
  admin: Admin,
  attachmentId: string
): Promise<{ owner: StepLogOwner; step: ChecklistStep; changes: Record<string, unknown> } | null> {
  const { data } = await admin
    .from("step_attachments")
    .select(
      "checklist_step_id, pre_loading_step_id, factory_id, client_id, file_name, order_checklist_steps(step), pre_loading_checklist_steps(step)"
    )
    .eq("id", attachmentId)
    .maybeSingle<{
      checklist_step_id: string | null;
      pre_loading_step_id: string | null;
      factory_id: string | null;
      client_id: string | null;
      file_name: string | null;
      order_checklist_steps: { step: ChecklistStep } | null;
      pre_loading_checklist_steps: { step: ChecklistStep } | null;
    }>();
  if (!data) return null;

  const changes = {
    file_name: data.file_name,
    ...(data.factory_id ? { factory_id: data.factory_id } : {}),
    ...(data.client_id ? { client_id: data.client_id } : {}),
  };
  if (data.checklist_step_id && data.order_checklist_steps) {
    return {
      owner: { checklistStepId: data.checklist_step_id },
      step: data.order_checklist_steps.step,
      changes,
    };
  }
  if (data.pre_loading_step_id && data.pre_loading_checklist_steps) {
    return {
      owner: { preLoadingStepId: data.pre_loading_step_id },
      step: data.pre_loading_checklist_steps.step,
      changes,
    };
  }
  return null;
}

export async function writeStepLog(
  admin: Admin,
  entry: {
    owner: StepLogOwner;
    step: ChecklistStep;
    action: ChecklistStepLogAction;
    changes?: Record<string, unknown>;
    userId: string | null;
  }
): Promise<void> {
  // Só alteração de usuário entra no log.
  if (!entry.userId) return;
  const changes = entry.changes ?? {};
  if (entry.action === "update" && Object.keys(changes).length === 0) return;

  const { error } = await admin.from("checklist_step_log").insert({
    checklist_step_id: "checklistStepId" in entry.owner ? entry.owner.checklistStepId : null,
    pre_loading_step_id: "preLoadingStepId" in entry.owner ? entry.owner.preLoadingStepId : null,
    step: entry.step,
    action: entry.action,
    changes,
    actor_id: entry.userId,
  });
  if (error) console.error("[checklist-step-log]", error.message);
}
