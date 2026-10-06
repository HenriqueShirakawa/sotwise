"use server";

import { revalidatePath } from "next/cache";

import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteOrderWithRules } from "@/domain/orders/delete-rules";
import {
  orderSchema,
  type OrderInput,
  type ActionResult,
  type CreateResult,
} from "@/domain/orders/schema";

const PATH = "/orders";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Maior po_number entre TODAS as orders (inclui soft-deleted: o número segue
 * ocupado no índice unique mesmo após um soft delete, então ignorá-las faria o
 * próximo insert colidir). po_number é texto; pagina de 1000 (limite PostgREST) e
 * calcula o máximo numérico aqui. Retorna null em erro de leitura.
 */
async function maxPo(admin: AdminClient): Promise<number | null> {
  let max = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("orders")
      .select("po_number")
      .range(from, from + 999);
    if (error || !data) return null;
    for (const r of data) {
      const n = Number(r.po_number) || 0;
      if (n > max) max = n;
    }
    if (data.length < 1000) break;
  }
  return max;
}

export async function createOrder(input: OrderInput): Promise<CreateResult> {
  const session = await requireFeature("orders", "create");

  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const admin = createAdminClient();
  const fields = {
    // Date PO = data em que o pedido foi aberto. Não vem do form (é derivada,
    // como o po_number); sem isso a Order nasce sem "Order date" e a tela de
    // ETD factories mostra "—" na coluna.
    date_po: new Date().toISOString().slice(0, 10),
    order_type_id: d.order_type_id,
    schedule_requested: d.schedule_requested,
    client_id: d.client_id,
    client_reference: d.client_reference,
    business_unit_id: d.business_unit_id,
    requester_id: d.requester_id,
    exporter_id: d.exporter_id,
    leader_id: d.leader_id,
    operational_responsible_id: d.operational_responsible_id,
    created_by: session.userId,
  };

  // po_number autoritativo = maior existente + 1 (sequencial). Conta TODAS as
  // orders, inclusive soft-deleted, senão o insert colide com um número que ainda
  // ocupa o índice unique. O valor vindo do client é ignorado (podia estar
  // defasado). O retry cobre a corrida entre dois usuários criando ao mesmo tempo:
  // o segundo insert bate 23505, recalcula o máximo e tenta o número seguinte.
  for (let attempt = 0; attempt < 6; attempt++) {
    const base = await maxPo(admin);
    if (base === null) {
      return { ok: false, error: "Could not read existing orders. Try again." };
    }
    const poNumber = String(base + 1);

    const { data, error } = await admin
      .from("orders")
      .insert({ ...fields, po_number: poNumber })
      .select("id, po_number")
      .single();
    if (!error) {
      // As 10 etapas da fase Order nascem junto com o pedido pelo trigger
      // `trg_orders_seed_checklist` (migration 20260824120000) — regra única no
      // banco, para que TODO caminho de criação (este, o endpoint inbound do
      // GSS, SQL manual) ganhe o checklist. Sem ele a order abriria com
      // "No checklist steps for this order.".
      revalidatePath(PATH);
      return { ok: true, id: data.id, po_number: data.po_number };
    }
    // Só a corrida de po_number (23505) justifica recalcular e tentar de novo;
    // qualquer outro erro sai na hora.
    if (error.code !== "23505") return { ok: false, error: error.message };
  }

  return { ok: false, error: "Could not assign an order number. Try again." };
}

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
