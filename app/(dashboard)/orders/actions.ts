"use server";

import { revalidatePath } from "next/cache";

import { verifySession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  orderSchema,
  type OrderInput,
  type ActionResult,
} from "@/domain/orders/schema";

const PATH = "/orders";

/** Mensagem amigável para violação de unique no po_number (código PG 23505). */
function friendlyError(error: { code?: string; message: string }, po?: string) {
  if (error.code === "23505")
    return `Order number ${po ?? ""} already exists.`.replace("  ", " ");
  return error.message;
}

export async function createOrder(input: OrderInput): Promise<ActionResult> {
  const session = await verifySession();

  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const admin = createAdminClient();
  const { error } = await admin.from("orders").insert({
    po_number: d.po_number,
    order_type_id: d.order_type_id,
    schedule_requested: d.schedule_requested,
    client_id: d.client_id,
    client_reference: d.client_reference,
    business_unit_id: d.business_unit_id,
    requester_id: d.requester_id,
    exporter_id: d.exporter_id,
    leader_id: d.leader_id,
    created_by: session.userId,
  });
  if (error) return { ok: false, error: friendlyError(error, d.po_number) };

  revalidatePath(PATH);
  return { ok: true };
}

export async function updateOrder(
  id: string,
  input: OrderInput
): Promise<ActionResult> {
  await verifySession();

  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const admin = createAdminClient();
  // po_number é imutável (auto-gerado) — não entra no update.
  const { error } = await admin
    .from("orders")
    .update({
      order_type_id: d.order_type_id,
      schedule_requested: d.schedule_requested,
      client_id: d.client_id,
      client_reference: d.client_reference,
      business_unit_id: d.business_unit_id,
      requester_id: d.requester_id,
      exporter_id: d.exporter_id,
      leader_id: d.leader_id,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteOrder(id: string): Promise<ActionResult> {
  await verifySession();

  const admin = createAdminClient();
  const { error } = await admin
    .from("orders")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}
