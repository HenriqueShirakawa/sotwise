"use server";

import { revalidatePath } from "next/cache";

import { verifySession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionResult } from "@/domain/orders/schema";
import type { BatchStatus, TablesUpdate } from "@/types/database";

const EDITABLE_BATCH_STATUSES: BatchStatus[] = ["in_negotiation", "in_production"];

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
