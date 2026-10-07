"use server";

import { revalidatePath } from "next/cache";

import { validateStepDates } from "@/lib/checklist-completion";
import { DOCUMENTS_BUCKET, type UploadTicket } from "@/lib/attachments";
import { isPathInDir, issueUploadTicket } from "@/lib/attachments-server";
import { scheduleClientNotificationDispatch } from "@/domain/client/notifications";
import { requireFeature } from "@/lib/dal";
import { confirmShippingRecord, type ConfirmShippingInput } from "@/domain/shipments/confirm";
import { autoCompletePlStep } from "@/lib/pl-step-autocomplete";
import { broadcastOrderStatusPing } from "@/lib/orders-realtime";
import { broadcastPreLoadingPing } from "@/lib/preloading-realtime";
import { broadcastShipmentPing } from "@/lib/shipments-realtime";
import { createAdminClient } from "@/lib/supabase/admin";
import { isGssShipmentStep, sendPlShipmentToGss } from "@/lib/gss/outbound/schedule";
import type { ChecklistStep } from "@/types/database";

type ActionResult = { ok: true } | { ok: false; error: string };


/** Campos editáveis de uma etapa — padrão + específicos (ver docs §3.9.5). */
export type StepPatch = Partial<{
  estimated_date: string | null;
  responsible_id: string | null;
  completed_on: string | null;
  signed_by_id: string | null;
  notes: string | null;
  consolidation_point_id: string | null;
  city_id: string | null;
  pol_id: string | null;
  carrier_id: string | null;
  agent_brazil_id: string | null;
  agent_china_id: string | null;
  contact_brazil_id: string | null;
  contact_china_id: string | null;
  booking_number: string | null;
  cutoff_date: string | null;
}>;

/** Campos que entram na regra de conclusão — só eles disparam a auto-conclusão. */
const COMPLETION_FACT_FIELDS: (keyof StepPatch)[] = [
  "estimated_date",
  "consolidation_point_id",
  "city_id",
  "pol_id",
  "carrier_id",
  "agent_brazil_id",
  "agent_china_id",
  "contact_brazil_id",
  "contact_china_id",
  "booking_number",
];

function touchesCompletionFacts(patch: StepPatch): boolean {
  return COMPLETION_FACT_FIELDS.some((k) => k in patch);
}

/**
 * Grava um campo de uma etapa do checklist do PL. As linhas de
 * `pre_loading_checklist_steps` nascem sob demanda — um PL recém-criado não
 * tem nenhuma —, por isso é upsert pela chave lógica (pre_loading_id, step).
 *
 * A coluna `done` é só o espelho de `completed_on` — não há toggle manual nesta
 * tela (docs/regras_de_negocio.md §3.9.5). Quem decide se a etapa aparece como
 * concluída é `lib/checklist-completion`, aplicada na LEITURA: a condição da
 * etapa envolve anexos e outros campos que mudam fora deste save, então gravar
 * o resultado aqui só criaria valor velho.
 */
export async function savePreLoadingStep(
  preLoadingId: string,
  step: ChecklistStep,
  patch: StepPatch
): Promise<ActionResult> {
  const session = await requireFeature("pre_loading", "edit");
  const admin = createAdminClient();

  const { data: existing, error: readError } = await admin
    .from("pre_loading_checklist_steps")
    .select("id, estimated_date, completed_on")
    .eq("pre_loading_id", preLoadingId)
    .eq("step", step)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };

  // "Completed on" exige "Estimated date" — travado também aqui, não só na UI.
  // Etapa que ainda não existe no banco entra como as duas datas vazias.
  const dateError = validateStepDates(
    existing ?? { estimated_date: null, completed_on: null },
    patch
  );
  if (dateError) return { ok: false, error: dateError };

  // "completed_on" no patch redefine o `done`; fora isso mantém o que já valia.
  const completedOn =
    "completed_on" in patch ? (patch.completed_on ?? null) : (existing?.completed_on ?? null);
  const values: StepPatch & { done: boolean } = { ...patch, done: completedOn != null };

  // Definir "Completed on" autopreenche "Signed by" com o usuário atual — quem
  // conclui a etapa assina (mesma regra do checklist de Orders). Só ao definir,
  // não ao limpar; o campo é travado na UI, então signed_by nunca vem no patch.
  if (patch.completed_on && patch.signed_by_id === undefined) {
    values.signed_by_id = session.userId;
  }

  const { error } = existing
    ? await admin.from("pre_loading_checklist_steps").update(values).eq("id", existing.id)
    : await admin
        .from("pre_loading_checklist_steps")
        .insert({ pre_loading_id: preLoadingId, step, ...values });
  if (error) return { ok: false, error: error.message };

  // Preencheu o que a etapa exige (cadastro/booking/data prevista)? Fecha sozinha.
  // Não roda quando o próprio patch mexe no "Completed on" — limpar a data à mão
  // não pode ser desfeito na mesma hora.
  if (!("completed_on" in patch) && touchesCompletionFacts(patch)) {
    await autoCompletePlStep(admin, preLoadingId, step, session.userId);
  }

  // Pelo padrão da rota, não por valor: a página vive em duas URLs (pl_number
  // bonito e UUID antigo) — isto invalida as duas de uma vez.
  revalidatePath("/pre-loading/[id]", "page");
  revalidatePath("/pre-loading");
  // Atribuir/trocar responsável ou concluir/reabrir etapa muda a To do list.
  revalidatePath("/todo");
  // Realtime: colunas da lista Pre-loading (datas/booking) mudaram.
  await broadcastPreLoadingPing();
  // Data do Loading date mudou → GSS na hora (depois da resposta).
  if (isGssShipmentStep(step)) sendPlShipmentToGss(preLoadingId);
  return { ok: true };
}

/** Id da etapa, criando a linha se ainda não existir (anexar antes de editar). */
async function ensureStepId(
  admin: ReturnType<typeof createAdminClient>,
  preLoadingId: string,
  step: ChecklistStep
): Promise<{ id: string } | { error: string }> {
  const { data: existing, error: readError } = await admin
    .from("pre_loading_checklist_steps")
    .select("id")
    .eq("pre_loading_id", preLoadingId)
    .eq("step", step)
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (existing) return { id: existing.id };

  const { data, error } = await admin
    .from("pre_loading_checklist_steps")
    .insert({ pre_loading_id: preLoadingId, step })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not create the step." };
  return { id: data.id };
}

/**
 * Upload de anexo em 2 actions (ticket + registro) — o arquivo vai direto do
 * browser pro Storage, nunca por aqui (limite de 4,5MB da Vercel; ver
 * lib/attachments.ts). O ticket já cria a linha da etapa se ela não existir.
 */
function attachmentDir(preLoadingId: string, stepRowId: string) {
  return `pre-loading/${preLoadingId}/${stepRowId}`;
}

export async function createPreLoadingAttachmentTicket(
  preLoadingId: string,
  step: ChecklistStep,
  fileName: string,
  fileSize: number
): Promise<UploadTicket> {
  await requireFeature("pre_loading", "edit");
  const admin = createAdminClient();

  const stepRow = await ensureStepId(admin, preLoadingId, step);
  if ("error" in stepRow) return { ok: false, error: stepRow.error };

  return issueUploadTicket(admin, attachmentDir(preLoadingId, stepRow.id), fileName, fileSize);
}

export async function registerPreLoadingAttachment(
  preLoadingId: string,
  step: ChecklistStep,
  filePath: string,
  fileName: string
): Promise<ActionResult> {
  const session = await requireFeature("pre_loading", "edit");
  const admin = createAdminClient();

  const stepRow = await ensureStepId(admin, preLoadingId, step);
  if ("error" in stepRow) return { ok: false, error: stepRow.error };
  if (!isPathInDir(filePath, attachmentDir(preLoadingId, stepRow.id))) {
    return { ok: false, error: "Invalid file path." };
  }

  const { error: insertError } = await admin.from("step_attachments").insert({
    pre_loading_step_id: stepRow.id,
    file_path: filePath,
    file_name: fileName,
    uploaded_by: session.userId,
  });
  if (insertError) {
    await admin.storage.from(DOCUMENTS_BUCKET).remove([filePath]);
    return { ok: false, error: insertError.message };
  }

  // O anexo pode ser o que faltava pra etapa fechar (ver lib/pl-step-autocomplete).
  const completed = await autoCompletePlStep(admin, preLoadingId, step, session.userId);

  revalidatePath("/pre-loading/[id]", "page");
  if (completed) {
    revalidatePath("/pre-loading");
    revalidatePath("/todo");
    await broadcastPreLoadingPing();
  }
  return { ok: true };
}

export async function getPreLoadingAttachmentUrl(
  filePath: string,
  fileName?: string | null
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireFeature("pre_loading", "view");
  const admin = createAdminClient();

  // `{ download }` força Content-Disposition: attachment (baixa em vez de abrir
  // inline numa aba em branco).
  const { data, error } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(filePath, 60, { download: fileName ?? true });
  if (error || !data) return { ok: false, error: error?.message ?? "Failed to sign URL." };

  return { ok: true, url: data.signedUrl };
}

export async function deletePreLoadingStepAttachment(
  preLoadingId: string,
  attachmentId: string,
  filePath: string
): Promise<ActionResult> {
  await requireFeature("pre_loading", "edit");
  const admin = createAdminClient();

  const { error } = await admin.from("step_attachments").delete().eq("id", attachmentId);
  if (error) return { ok: false, error: error.message };

  await admin.storage.from(DOCUMENTS_BUCKET).remove([filePath]);

  revalidatePath("/pre-loading/[id]", "page");
  return { ok: true };
}


/**
 * "Confirm Shipping" do botão da tela. Validação + RPC atômica + gêmeas do split
 * moram em domain/shipments/confirm.ts (o PATCH /api/shipments/{id} com
 * `status: "in_transit"` usa o mesmo caminho); aqui ficam a autorização, a
 * revalidação das telas e o envio ao GSS.
 */
export async function confirmShipping(
  preLoadingId: string,
  input: ConfirmShippingInput
): Promise<ActionResult> {
  const session = await requireFeature("pre_loading", "edit");
  const admin = createAdminClient();

  const result = await confirmShippingRecord(admin, preLoadingId, input, session.userId);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/pre-loading/[id]", "page");
  revalidatePath("/pre-loading");
  revalidatePath("/orders");
  // Confirmar o embarque CRIA o Shipment — a lista de Shipments precisa
  // refletir o novo registro (senão só aparece após um F5).
  revalidatePath("/shipments");
  // Realtime: novo embarque na lista Shipments E o PL sai da lista Pre-loading.
  await broadcastShipmentPing();
  await broadcastPreLoadingPing();
  if (result.changed_order_ids.length > 0) {
    await broadcastOrderStatusPing({ order_ids: result.changed_order_ids });
  }
  await scheduleClientNotificationDispatch();
  // A RPC grava o Loading date concluído → GSS.
  sendPlShipmentToGss(preLoadingId);
  return { ok: true };
}
