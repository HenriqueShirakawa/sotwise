"use server";

import { revalidatePath } from "next/cache";

import { verifySession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionResult } from "@/domain/orders/schema";
import type { BatchStatus, TablesInsert, TablesUpdate } from "@/types/database";

const EDITABLE_BATCH_STATUSES: BatchStatus[] = ["in_negotiation", "in_production"];
const DOCUMENTS_BUCKET = "order-documents";
const MAX_FILE_BYTES = 20 * 1024 * 1024;

function path(orderId: string) {
  return `/orders/${orderId}`;
}

/** Batch só é editável (status ou Factory x Category) em in_negotiation/in_production. */
async function assertBatchEditable(batchId: string) {
  const admin = createAdminClient();
  const { data: batch } = await admin
    .from("batches")
    .select("id, status")
    .eq("id", batchId)
    .single();
  if (!batch || !EDITABLE_BATCH_STATUSES.includes(batch.status)) {
    throw new Error("This batch can only be edited while In Negotiation or In Production.");
  }
  return batch;
}

export async function updateBatchStatus(
  orderId: string,
  batchId: string,
  status: BatchStatus
): Promise<ActionResult> {
  await verifySession();
  const admin = createAdminClient();

  await assertBatchEditable(batchId);

  const { error } = await admin.from("batches").update({ status }).eq("id", batchId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(path(orderId));
  return { ok: true };
}

export async function updateBatchNumber(
  orderId: string,
  batchId: string,
  batch_number: string
): Promise<ActionResult> {
  await verifySession();
  const admin = createAdminClient();

  await assertBatchEditable(batchId);

  const { error } = await admin.from("batches").update({ batch_number }).eq("id", batchId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(path(orderId));
  return { ok: true };
}

export async function createBatch(
  orderId: string,
  input: {
    batch_number: string;
    rows: { category_id: string; factory_id: string; ship_requirement: string }[];
  }
): Promise<ActionResult> {
  await verifySession();
  const admin = createAdminClient();

  const { data: batch, error } = await admin
    .from("batches")
    .insert({ order_id: orderId, batch_number: input.batch_number })
    .select("id")
    .single();
  if (error || !batch) return { ok: false, error: error?.message ?? "Failed to create batch." };

  if (input.rows.length > 0) {
    const { error: rowsError } = await admin.from("order_factory_category").insert(
      input.rows.map((r) => ({
        order_id: orderId,
        batch_id: batch.id,
        category_id: r.category_id,
        factory_id: r.factory_id,
        ship_requirement: r.ship_requirement,
      }))
    );
    if (rowsError) return { ok: false, error: rowsError.message };
  }

  revalidatePath(path(orderId));
  return { ok: true };
}

export async function deleteBatch(orderId: string, batchId: string): Promise<ActionResult> {
  await verifySession();
  const admin = createAdminClient();

  await assertBatchEditable(batchId);

  const { error } = await admin.from("batches").delete().eq("id", batchId);
  if (error) {
    return {
      ok: false,
      error: "Can't delete this batch — it still has entries linked to it.",
    };
  }

  revalidatePath(path(orderId));
  return { ok: true };
}

export async function updateOrderFactoryCategoryBatch(
  orderId: string,
  id: string,
  batchId: string
): Promise<ActionResult> {
  await verifySession();
  const admin = createAdminClient();

  await assertBatchEditable(batchId);

  const { error } = await admin
    .from("order_factory_category")
    .update({ batch_id: batchId })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(path(orderId));
  return { ok: true };
}

/**
 * Bulk import do CSV "Factory x Category". Category/Factory já vêm validados
 * (ids resolvidos) pelo cliente antes do Insert — aqui só resta o Batch No.,
 * que segue a mesma mecânica do seletor manual: usa o lote existente (match
 * por número) ou cria um novo na hora.
 */
export async function bulkImportOrderFactoryCategory(
  orderId: string,
  rows: {
    category_id: string;
    factory_id: string;
    batch_number: string;
    ship_requirement: string;
  }[]
): Promise<ActionResult> {
  await verifySession();
  const admin = createAdminClient();

  if (rows.length === 0) return { ok: false, error: "Nothing to import." };

  const { data: existingBatches, error: batchesError } = await admin
    .from("batches")
    .select("id, batch_number")
    .eq("order_id", orderId);
  if (batchesError) return { ok: false, error: batchesError.message };

  const batchIdByNumber = new Map(
    (existingBatches ?? []).map((b) => [b.batch_number.trim().toLowerCase(), b.id])
  );

  const newBatchNumbers = Array.from(
    new Set(
      rows
        .map((r) => r.batch_number.trim())
        .filter((n) => n && !batchIdByNumber.has(n.toLowerCase()))
    )
  );

  if (newBatchNumbers.length > 0) {
    const { data: createdBatches, error: createError } = await admin
      .from("batches")
      .insert(newBatchNumbers.map((batch_number) => ({ order_id: orderId, batch_number })))
      .select("id, batch_number");
    if (createError) return { ok: false, error: createError.message };
    for (const b of createdBatches ?? []) {
      batchIdByNumber.set(b.batch_number.trim().toLowerCase(), b.id);
    }
  }

  const { error: insertError } = await admin.from("order_factory_category").insert(
    rows.map((r) => ({
      order_id: orderId,
      category_id: r.category_id,
      factory_id: r.factory_id,
      batch_id: batchIdByNumber.get(r.batch_number.trim().toLowerCase()) ?? null,
      ship_requirement: r.ship_requirement,
    }))
  );
  if (insertError) return { ok: false, error: insertError.message };

  revalidatePath(path(orderId));
  return { ok: true };
}

export async function createOrderFactoryCategory(
  orderId: string,
  input: {
    batch_id: string;
    category_id: string;
    factory_id: string;
    ship_requirement: string;
  }
): Promise<ActionResult> {
  await verifySession();
  const admin = createAdminClient();

  await assertBatchEditable(input.batch_id);

  const { error } = await admin.from("order_factory_category").insert({
    order_id: orderId,
    batch_id: input.batch_id,
    category_id: input.category_id,
    factory_id: input.factory_id,
    ship_requirement: input.ship_requirement,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(path(orderId));
  return { ok: true };
}

export async function deleteOrderFactoryCategory(
  orderId: string,
  batchId: string,
  id: string
): Promise<ActionResult> {
  await verifySession();
  const admin = createAdminClient();

  await assertBatchEditable(batchId);

  const { error } = await admin.from("order_factory_category").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(path(orderId));
  return { ok: true };
}

export async function updateChecklistStep(
  orderId: string,
  stepId: string,
  patch: {
    estimated_date?: string | null;
    responsible_id?: string | null;
    completed_on?: string | null;
    signed_by_id?: string | null;
    enabled?: boolean;
  }
): Promise<ActionResult> {
  const session = await verifySession();
  const admin = createAdminClient();

  const update: TablesUpdate<"order_checklist_steps"> = { ...patch };
  if ("completed_on" in patch) update.done = !!patch.completed_on;
  // Selecionar Completed On autopreenche o Signed By com o usuário atual —
  // só quando o campo está sendo definido (não ao limpar) e ninguém setou
  // signed_by explicitamente nesta mesma chamada.
  if (patch.completed_on && patch.signed_by_id === undefined) {
    update.signed_by_id = session.userId;
  }

  const { error } = await admin.from("order_checklist_steps").update(update).eq("id", stepId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(path(orderId));
  return { ok: true };
}

export async function uploadStepAttachment(
  orderId: string,
  stepId: string,
  formData: FormData,
  factoryId?: string | null
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

  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const filePath = `${orderId}/${stepId}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(filePath, file, { contentType: file.type || undefined });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { error: insertError } = await admin.from("step_attachments").insert({
    checklist_step_id: stepId,
    factory_id: factoryId ?? null,
    file_path: filePath,
    file_name: file.name,
    uploaded_by: session.userId,
  });
  if (insertError) {
    await admin.storage.from(DOCUMENTS_BUCKET).remove([filePath]);
    return { ok: false, error: insertError.message };
  }

  revalidatePath(path(orderId));
  return { ok: true };
}

export async function getAttachmentDownloadUrl(
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

export async function deleteStepAttachment(
  orderId: string,
  attachmentId: string,
  filePath: string
): Promise<ActionResult> {
  await verifySession();
  const admin = createAdminClient();

  const { error } = await admin.from("step_attachments").delete().eq("id", attachmentId);
  if (error) return { ok: false, error: error.message };

  await admin.storage.from(DOCUMENTS_BUCKET).remove([filePath]);

  revalidatePath(path(orderId));
  return { ok: true };
}

/**
 * Upsert dos dados de ETD de UMA entrada Factory x Category (linha da etapa
 * ETD). `current_date`/`ready_date` são preenchidos automaticamente na
 * primeira vez que `initial_date`/`ready` são setados (ver docs/regras_de_negocio.md §3.7.4).
 */
export async function upsertEtdInfo(
  orderId: string,
  ofcId: string,
  patch: {
    inspection?: boolean;
    ready?: boolean;
    initial_date?: string | null;
    dispatch_location_id?: string | null;
    dispatch_date?: string | null;
    remarks?: string | null;
  }
): Promise<ActionResult> {
  await verifySession();
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("etd_info")
    .select("current_date, ready_date")
    .eq("order_factory_category_id", ofcId)
    .maybeSingle();

  const update: TablesInsert<"etd_info"> = {
    order_factory_category_id: ofcId,
    ...patch,
  };
  if (patch.initial_date && !existing?.current_date) {
    update.current_date = new Date().toISOString().slice(0, 10);
  }
  if (patch.ready === true && !existing?.ready_date) {
    update.ready_date = new Date().toISOString().slice(0, 10);
  }

  const { error } = await admin
    .from("etd_info")
    .upsert(update, { onConflict: "order_factory_category_id" });
  if (error) return { ok: false, error: error.message };

  revalidatePath(path(orderId));
  return { ok: true };
}
