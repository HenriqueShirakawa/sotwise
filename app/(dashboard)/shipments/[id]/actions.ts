"use server";

import { revalidatePath } from "next/cache";

import { verifySession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ChecklistStep } from "@/types/database";

type ActionResult = { ok: true } | { ok: false; error: string };

const DOCUMENTS_BUCKET = "order-documents";
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Campos editáveis nas etapas da fase Shipment. Nenhuma delas tem campo
 * específico além do texto aberto de Original Docs (docs §3.10.4).
 */
export type ShipmentStepPatch = Partial<{
  estimated_date: string | null;
  responsible_id: string | null;
  completed_on: string | null;
  notes: string | null;
}>;

type Admin = ReturnType<typeof createAdminClient>;

function paths(shipmentId: string) {
  return [`/shipments/${shipmentId}`, "/shipments"];
}

/** Id da etapa, criando a linha se ainda não existir. */
async function ensureStepId(
  admin: Admin,
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
 * Conclusão da etapa "Delivered" (#24) encerra a esteira: todos os lotes do
 * embarque vão para `delivered` e o Shipment também (docs §3.10.4). Limpar a
 * data reabre — os lotes voltam para `in_transit`.
 */
async function applyDeliveredRule(
  admin: Admin,
  shipmentId: string,
  preLoadingId: string,
  delivered: boolean
): Promise<string | null> {
  const { data: links, error: linkError } = await admin
    .from("pre_loading_batches")
    .select("batch_id")
    .eq("pre_loading_id", preLoadingId);
  if (linkError) return linkError.message;

  const batchIds = (links ?? []).map((l) => l.batch_id);
  if (batchIds.length) {
    const { error } = await admin
      .from("batches")
      .update({ status: delivered ? "delivered" : "in_transit" })
      .in("id", batchIds);
    if (error) return error.message;
  }

  const { error: shipmentError } = await admin
    .from("shipments")
    .update({ status: delivered ? "delivered" : "in_transit" })
    .eq("id", shipmentId);
  return shipmentError?.message ?? null;
}

/**
 * Grava um campo de uma etapa da fase Shipment. O checklist é o MESMO do
 * Pre-loading (`pre_loading_checklist_steps`, ancorado no pre_loading_id —
 * docs §3.9.5), por isso a escrita é na mesma tabela; muda só o que a tela
 * deixa editar e a revalidação.
 */
export async function saveShipmentStep(
  shipmentId: string,
  preLoadingId: string,
  step: ChecklistStep,
  patch: ShipmentStepPatch
): Promise<ActionResult> {
  const session = await verifySession();
  const admin = createAdminClient();

  const { data: existing, error: readError } = await admin
    .from("pre_loading_checklist_steps")
    .select("id, completed_on")
    .eq("pre_loading_id", preLoadingId)
    .eq("step", step)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };

  const completedOn =
    "completed_on" in patch ? (patch.completed_on ?? null) : (existing?.completed_on ?? null);
  const values: ShipmentStepPatch & { done: boolean; signed_by_id?: string } = {
    ...patch,
    done: completedOn != null,
  };

  // Quem conclui a etapa assina — mesma regra do checklist de Pre-loading.
  if (patch.completed_on) values.signed_by_id = session.userId;

  const { error } = existing
    ? await admin.from("pre_loading_checklist_steps").update(values).eq("id", existing.id)
    : await admin
        .from("pre_loading_checklist_steps")
        .insert({ pre_loading_id: preLoadingId, step, ...values });
  if (error) return { ok: false, error: error.message };

  if (step === "delivered" && "completed_on" in patch) {
    const ruleError = await applyDeliveredRule(
      admin,
      shipmentId,
      preLoadingId,
      completedOn != null
    );
    if (ruleError) return { ok: false, error: ruleError };
  }

  for (const p of paths(shipmentId)) revalidatePath(p);
  return { ok: true };
}

export async function uploadShipmentStepAttachment(
  shipmentId: string,
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

  for (const p of paths(shipmentId)) revalidatePath(p);
  return { ok: true };
}

export async function getShipmentAttachmentUrl(
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

export async function deleteShipmentStepAttachment(
  shipmentId: string,
  attachmentId: string,
  filePath: string
): Promise<ActionResult> {
  await verifySession();
  const admin = createAdminClient();

  const { error } = await admin.from("step_attachments").delete().eq("id", attachmentId);
  if (error) return { ok: false, error: error.message };

  await admin.storage.from(DOCUMENTS_BUCKET).remove([filePath]);

  for (const p of paths(shipmentId)) revalidatePath(p);
  return { ok: true };
}
