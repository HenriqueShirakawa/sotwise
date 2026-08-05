"use server";

import { revalidatePath } from "next/cache";

import { verifySession } from "@/lib/dal";
import { ORDER_STEPS } from "@/lib/checklist";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OrderStatus } from "@/types/database";
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
  const session = await verifySession();

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
      .select("id")
      .single();
    if (!error) {
      // As 10 etapas da fase Order nascem junto com o pedido. A tela de detalhe
      // só renderiza etapa que tem linha (page.tsx filtra por STEP_ORDER), então
      // sem esse seed a order nova abre com "No checklist steps for this order."
      // As orders vindas do Bubble já trouxeram as linhas na migração.
      const { error: stepsError } = await admin
        .from("order_checklist_steps")
        .insert(ORDER_STEPS.map((step) => ({ order_id: data.id, step })));
      if (stepsError) return { ok: false, error: stepsError.message };

      revalidatePath(PATH);
      return { ok: true, id: data.id };
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

/**
 * Status em que uma Order pode ser excluída. Depois de entrar num Pre-loading/
 * embarque ela tem PL/Shipment dependentes — apagá-la deixaria órfãos, então só
 * as fases iniciais (ou uma order cancelada) são deletáveis. A UI desabilita a
 * lixeira nos demais status; aqui é a trava de servidor.
 */
const DELETABLE_ORDER_STATUSES = new Set<OrderStatus>([
  "in_negotiation",
  "in_production",
  "canceled",
]);

export async function deleteOrder(id: string): Promise<ActionResult> {
  await verifySession();

  const admin = createAdminClient();

  const { data: order, error: readError } = await admin
    .from("orders")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!order) return { ok: false, error: "Order not found." };
  if (!DELETABLE_ORDER_STATUSES.has(order.status)) {
    return {
      ok: false,
      error: "Only orders in Negotiation, Production or Canceled can be deleted.",
    };
  }

  // Hard delete: a order sai de vez e, em cascata, vão os lotes, OFC/ETD e o
  // checklist (FKs order_id ON DELETE CASCADE). Se algum lote estiver dentro de um
  // Pre-loading, o vínculo é solto pela migration 20260805130000
  // (pre_loading_batches.batch_id ON DELETE CASCADE) — sem ela o delete trava em FK.
  const { error } = await admin.from("orders").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}
