"use server";

import { revalidatePath } from "next/cache";

import { requireFeature } from "@/lib/dal";
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
      // As 10 etapas da fase Order nascem junto com o pedido pelo trigger
      // `trg_orders_seed_checklist` (migration 20260824120000) — regra única no
      // banco, para que TODO caminho de criação (este, o endpoint inbound do
      // GSS, SQL manual) ganhe o checklist. Sem ele a order abriria com
      // "No checklist steps for this order.".
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

/**
 * Diz se algum lote da order já entrou num Pre-loading (e se aquele Pre-loading
 * virou Shipment). Devolve o rótulo pronto para a mensagem de erro, ou null se
 * a order estiver solta e puder ser apagada.
 */
async function findLinkedShipping(
  admin: ReturnType<typeof createAdminClient>,
  orderId: string
): Promise<{ kind: "pre-loading" | "shipment"; number: string } | null> {
  const { data: batches } = await admin
    .from("batches")
    .select("id")
    .eq("order_id", orderId);
  const batchIds = (batches ?? []).map((b) => b.id);
  if (!batchIds.length) return null;

  const { data: links } = await admin
    .from("pre_loading_batches")
    .select("pre_loading_id")
    .in("batch_id", batchIds)
    .limit(1);
  const preLoadingId = links?.[0]?.pre_loading_id;
  if (!preLoadingId) return null;

  const [{ data: preLoading }, { data: shipment }] = await Promise.all([
    admin.from("pre_loadings").select("pl_number").eq("id", preLoadingId).maybeSingle(),
    admin.from("shipments").select("id").eq("pre_loading_id", preLoadingId).maybeSingle(),
  ]);

  return {
    kind: shipment ? "shipment" : "pre-loading",
    number: preLoading?.pl_number ?? "—",
  };
}

export async function deleteOrder(id: string): Promise<ActionResult> {
  await requireFeature("orders", "delete");

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

  // Order com embarque não pode ser apagada. O delete abaixo é em cascata e
  // solta o vínculo em pre_loading_batches, mas NÃO remove o Pre-loading nem o
  // Shipment: eles sobravam sem pedido de origem, invisíveis nas listagens e
  // sem botão para limpar — foi o que travou a numeração no QA de 05/08.
  // Bloquear em vez de cascatear é a escolha reversível: o usuário desfaz o
  // embarque e só então apaga o pedido; cascatear destruiria um embarque real
  // num clique, sem lixeira para recuperar.
  const linked = await findLinkedShipping(admin, id);
  if (linked) {
    return {
      ok: false,
      error: `This order is already in ${linked.kind} ${linked.number}. Remove it from there before deleting the order.`,
    };
  }

  // Hard delete: a order sai de vez e, em cascata, vão os lotes, OFC/ETD e o
  // checklist (FKs order_id ON DELETE CASCADE).
  const { error } = await admin.from("orders").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}
