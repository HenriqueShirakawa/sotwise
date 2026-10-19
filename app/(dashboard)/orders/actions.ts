"use server";

import { revalidatePath } from "next/cache";

import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteOrderWithRules } from "@/domain/orders/delete-rules";
import {
  orderSchema,
  type OrderInput,
  type ActionResult,
} from "@/domain/orders/schema";

const PATH = "/orders";

export async function updateOrder(
  id: string,
  input: OrderInput
): Promise<ActionResult> {
  await requireFeature("orders", "edit");

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
      operational_responsible_id: d.operational_responsible_id,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteOrder(id: string): Promise<ActionResult> {
  await requireFeature("orders", "delete");

  // Travas (status deletável, sem PL/Shipment) + hard delete — mesmas da API
  // (DELETE /api/orders/{id}); ver domain/orders/delete-rules.ts.
  const result = await deleteOrderWithRules(createAdminClient(), id);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(PATH);
  return { ok: true };
}
