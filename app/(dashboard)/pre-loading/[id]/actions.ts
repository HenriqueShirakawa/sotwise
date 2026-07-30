"use server";

import { revalidatePath } from "next/cache";

import { verifySession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ChecklistStep } from "@/types/database";

type ActionResult = { ok: true } | { ok: false; error: string };

const DOCUMENTS_BUCKET = "order-documents";
const MAX_FILE_BYTES = 20 * 1024 * 1024;

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
  carrier_agent_id: string | null;
  agent_brazil_id: string | null;
  agent_china_id: string | null;
  contact_brazil_id: string | null;
  contact_china_id: string | null;
  booking_number: string | null;
}>;

/**
 * Grava um campo de uma etapa do checklist do PL. As linhas de
 * `pre_loading_checklist_steps` nascem sob demanda — um PL recém-criado não
 * tem nenhuma —, por isso é upsert pela chave lógica (pre_loading_id, step).
 *
 * `done` é DERIVADO de `completed_on`: não há toggle manual nesta tela
 * (docs/regras_de_negocio.md §3.9.5).
 */
export async function savePreLoadingStep(
  preLoadingId: string,
  step: ChecklistStep,
  patch: StepPatch
): Promise<ActionResult> {
  await verifySession();
  const admin = createAdminClient();

  const { data: existing, error: readError } = await admin
    .from("pre_loading_checklist_steps")
    .select("id, completed_on")
    .eq("pre_loading_id", preLoadingId)
    .eq("step", step)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };

  // "completed_on" no patch redefine o `done`; fora isso mantém o que já valia.
  const completedOn =
    "completed_on" in patch ? (patch.completed_on ?? null) : (existing?.completed_on ?? null);
  const values = { ...patch, done: completedOn != null };

  const { error } = existing
    ? await admin.from("pre_loading_checklist_steps").update(values).eq("id", existing.id)
    : await admin
        .from("pre_loading_checklist_steps")
        .insert({ pre_loading_id: preLoadingId, step, ...values });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/pre-loading/${preLoadingId}`);
  revalidatePath("/pre-loading");
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

export async function uploadPreLoadingStepAttachment(
  preLoadingId: string,
  step: ChecklistStep,
  formData: FormData
): Promise<ActionResult> {
  const session = await verifySession();
  const admin = createAdminClient();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file selected." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: "File is larger than 20MB." };
  }

  const stepRow = await ensureStepId(admin, preLoadingId, step);
  if ("error" in stepRow) return { ok: false, error: stepRow.error };

  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const filePath = `pre-loading/${preLoadingId}/${stepRow.id}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(filePath, file, { contentType: file.type || undefined });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { error: insertError } = await admin.from("step_attachments").insert({
    pre_loading_step_id: stepRow.id,
    file_path: filePath,
    file_name: file.name,
    uploaded_by: session.userId,
  });
  if (insertError) {
    await admin.storage.from(DOCUMENTS_BUCKET).remove([filePath]);
    return { ok: false, error: insertError.message };
  }

  revalidatePath(`/pre-loading/${preLoadingId}`);
  return { ok: true };
}

export async function getPreLoadingAttachmentUrl(
  filePath: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await verifySession();
  const admin = createAdminClient();

  const { data, error } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(filePath, 60);
  if (error || !data) return { ok: false, error: error?.message ?? "Failed to sign URL." };

  return { ok: true, url: data.signedUrl };
}

export async function deletePreLoadingStepAttachment(
  preLoadingId: string,
  attachmentId: string,
  filePath: string
): Promise<ActionResult> {
  await verifySession();
  const admin = createAdminClient();

  const { error } = await admin.from("step_attachments").delete().eq("id", attachmentId);
  if (error) return { ok: false, error: error.message };

  await admin.storage.from(DOCUMENTS_BUCKET).remove([filePath]);

  revalidatePath(`/pre-loading/${preLoadingId}`);
  return { ok: true };
}
