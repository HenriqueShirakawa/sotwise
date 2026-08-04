"use server";

import { revalidatePath } from "next/cache";

import { verifySession } from "@/lib/dal";
import { ORDER_STEPS } from "@/lib/checklist";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  orderSchema,
  type OrderInput,
  type ActionResult,
  type CreateResult,
} from "@/domain/orders/schema";

const PATH = "/orders";

/** Mensagem amigável para violação de unique no po_number (código PG 23505). */
function friendlyError(error: { code?: string; message: string }, po?: string) {
  if (error.code === "23505")
    return `Order number ${po ?? ""} already exists.`.replace("  ", " ");
  return error.message;
}

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Maior po_number ATIVO (ignora soft-deleted). po_number é texto, então busca só
 * a coluna e calcula o máximo numérico aqui. Pagina de 1000 (limite PostgREST).
 * Retorna null em erro de leitura.
 */
async function maxActivePo(admin: AdminClient): Promise<number | null> {
  let max = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("orders")
      .select("po_number")
      .is("deleted_at", null)
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

  // po_number autoritativo = maior ATIVO + 1 (sequencial, estilo Bubble). O valor
  // vindo do client é ignorado (podia estar defasado). Se o número estiver preso
  // por uma order SOFT-DELETED do topo (que foi excluída), libera com hard delete
  // (cascata nos filhos) e reaproveita o número. NUNCA mexe em order ativa; e o
  // retry cobre corrida entre dois usuários criando ao mesmo tempo.
  for (let attempt = 0; attempt < 6; attempt++) {
    const base = await maxActivePo(admin);
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
    if (error.code !== "23505") {
      return { ok: false, error: friendlyError(error, poNumber) };
    }

    // Colisão nesse número: alguém já o tem. Se for uma order SOFT-DELETED (topo
    // excluído), apaga de vez (cascata) e reaproveita. Se for ATIVA (corrida), o
    // próximo loop recomputa o máximo e tenta o número seguinte.
    const { data: clash } = await admin
      .from("orders")
      .select("id, deleted_at")
      .eq("po_number", poNumber)
      .maybeSingle();
    if (clash?.deleted_at) {
      await admin.from("orders").delete().eq("id", clash.id);
    }
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
