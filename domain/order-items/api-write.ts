import "server-only";

import { revalidatePath } from "next/cache";

import { broadcastEtdPing } from "@/lib/etd-realtime";
import { broadcastOrderStatusPing } from "@/lib/orders-realtime";
import { syncOrderStatus } from "@/lib/order-status";
import type { createAdminClient } from "@/lib/supabase/admin";
import { fail, type WriteResult } from "@/domain/api/write-result";
import { findOrderRef, resolveBatchKey } from "@/domain/batches/api-read";
import { EDITABLE_BATCH_STATUSES } from "@/domain/batches/api-schema";
import { updateBatch } from "@/domain/batches/api-write";
import type { BatchStatus } from "@/types/database";

import { getOrderItem, type OrderItemRead } from "./api-read";
import type { CreateOrderItemInput, UpdateOrderItemInput } from "./api-schema";

/**
 * Escrita das linhas FACTORY × CATEGORY pela API.
 *
 * Tudo que envolve LOTE passa pela escrita de lotes (domain/batches/api-write
 * → updateBatch), que já tem as travas da tela: lote só editável em
 * In Negotiation/In Production (destino E origem), sem gêmeas (mesma Category
 * + Factory duas vezes no lote), lote In Production nunca vazio, promoção por
 * Deposit Payment e rollup do status da Order. Aqui fica só o que é da linha
 * em si: criar sem lote, mudar o ship requirement e apagar.
 */

type AdminClient = ReturnType<typeof createAdminClient>;
type UUID = string;

const isEditable = (status: BatchStatus) =>
  (EDITABLE_BATCH_STATUSES as readonly BatchStatus[]).includes(status);

const NOT_EDITABLE =
  "can only be changed while In Negotiation or In Production (later statuses are driven by the Pre-loading/Shipment flow).";

async function refreshViews(orderId: UUID) {
  revalidatePath("/orders/[id]", "page");
  revalidatePath("/orders");
  revalidatePath("/pre-loading");
  revalidatePath("/etd-factories");
  await broadcastEtdPing({ order_ids: [orderId] });
}

async function readBack(admin: AdminClient, id: UUID, status: 200 | 201): Promise<WriteResult<OrderItemRead>> {
  const item = await getOrderItem(admin, id);
  if (!item) return fail(500, "Item was saved but could not be read back.");
  return { ok: true, status, data: item };
}

/** Lote do `{batch_id}` (UUID ou full_number) — precisa ser da order. */
async function resolveOrderBatch(
  admin: AdminClient,
  orderId: UUID,
  key: string
): Promise<{ ok: true; id: UUID } | Extract<WriteResult<never>, { ok: false }>> {
  const batchId = await resolveBatchKey(admin, key);
  if (!batchId) return fail(400, `Batch '${key}' not found.`);
  const { data, error } = await admin.from("batches").select("order_id").eq("id", batchId).maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(400, `Batch '${key}' not found.`);
  if (data.order_id !== orderId) return fail(400, `Batch '${key}' belongs to another order.`);
  return { ok: true, id: batchId };
}

export async function createOrderItem(
  admin: AdminClient,
  input: CreateOrderItemInput
): Promise<WriteResult<OrderItemRead>> {
  const order = await findOrderRef(admin, input);
  if (!order) {
    return fail(
      400,
      input.order_gss_id
        ? `No order found for order_gss_id '${input.order_gss_id}'.`
        : `No order found for po_number '${input.po_number}'.`
    );
  }

  const { data: product, error: productError } = await admin
    .from("factory_products")
    .select("factory_id, category_id")
    .eq("gss_id", input.supplier_category_gss_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (productError) return fail(500, productError.message);
  if (!product) {
    return fail(
      400,
      `No factory_products found for supplier_category_gss_id '${input.supplier_category_gss_id}'.`
    );
  }

  if (input.batch_id) {
    // Linha que já nasce num lote: a escrita de lotes cria e aplica as travas.
    const batch = await resolveOrderBatch(admin, order.id, input.batch_id);
    if (!batch.ok) return batch;
    const result = await updateBatch(admin, batch.id, {
      items: [
        {
          supplier_category_gss_id: input.supplier_category_gss_id,
          ship_requirement: input.ship_requirement,
        },
      ],
    });
    if (!result.ok) return result;
    const created = result.data.items.find(
      (i) => i.factory?.id === product.factory_id && i.category?.id === product.category_id
    );
    if (!created) return fail(500, "Item was saved but could not be read back.");
    return readBack(admin, created.id, 201);
  }

  // Sem lote: não duplica um par que já está solto na order (reenvio do GSS).
  const { data: loose, error: looseError } = await admin
    .from("order_factory_category")
    .select("id")
    .eq("order_id", order.id)
    .eq("factory_id", product.factory_id)
    .eq("category_id", product.category_id)
    .is("batch_id", null)
    .limit(1);
  if (looseError) return fail(500, looseError.message);
  if (loose && loose.length > 0) {
    return fail(
      409,
      `This Factory x Category is already in order ${order.po_number} without a batch (item '${loose[0].id}').`
    );
  }

  const { data: row, error } = await admin
    .from("order_factory_category")
    .insert({
      order_id: order.id,
      factory_id: product.factory_id,
      category_id: product.category_id,
      ship_requirement: input.ship_requirement,
    })
    .select("id")
    .single();
  if (error || !row) return fail(500, error?.message ?? "Failed to create item.");

  await refreshViews(order.id);
  // A lista de Orders só mostra order com ≥1 linha — o ping a faz aparecer sem F5.
  await broadcastOrderStatusPing({ order_ids: [order.id] });
  return readBack(admin, row.id, 201);
}

type LineRow = { id: UUID; order_id: UUID; batch_id: UUID | null };

async function loadLine(admin: AdminClient, id: UUID): Promise<{ ok: true; line: LineRow } | Extract<WriteResult<never>, { ok: false }>> {
  const { data, error } = await admin
    .from("order_factory_category")
    .select("id, order_id, batch_id")
    .eq("id", id)
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(404, "Item not found.");
  return { ok: true, line: data };
}

async function batchOf(admin: AdminClient, batchId: UUID) {
  const { data, error } = await admin
    .from("batches")
    .select("id, batch_number, status")
    .eq("id", batchId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateOrderItem(
  admin: AdminClient,
  id: UUID,
  input: UpdateOrderItemInput
): Promise<WriteResult<OrderItemRead>> {
  const loaded = await loadLine(admin, id);
  if (!loaded.ok) return loaded;
  const { line } = loaded;

  // Resolve o destino antes de qualquer escrita.
  let targetBatchId: UUID | null | undefined = undefined;
  if (input.batch_id !== undefined) {
    if (input.batch_id === null) {
      targetBatchId = null;
    } else {
      const target = await resolveOrderBatch(admin, line.order_id, input.batch_id);
      if (!target.ok) return target;
      targetBatchId = target.id;
    }
  }
  const moving = targetBatchId !== undefined && targetBatchId !== line.batch_id;

  // Ship requirement só muda com a linha num lote editável (ou sem lote) — o
  // lote em que ela vai FICAR.
  if (input.ship_requirement !== undefined) {
    const finalBatchId = moving ? targetBatchId : line.batch_id;
    if (finalBatchId) {
      const batch = await batchOf(admin, finalBatchId);
      if (batch && !isEditable(batch.status)) {
        return fail(409, `Batch '${batch.batch_number}' ${NOT_EDITABLE}`);
      }
    }
  }

  if (moving) {
    const result =
      targetBatchId === null
        ? await updateBatch(admin, line.batch_id!, { remove_item_ids: [id] })
        : await updateBatch(admin, targetBatchId!, { item_ids: [id] });
    if (!result.ok) return result;
  }

  if (input.ship_requirement !== undefined) {
    const { error } = await admin
      .from("order_factory_category")
      .update({ ship_requirement: input.ship_requirement })
      .eq("id", id);
    if (error) return fail(500, error.message);
    await refreshViews(line.order_id);
  }

  return readBack(admin, id, 200);
}

export async function deleteOrderItem(
  admin: AdminClient,
  id: UUID
): Promise<WriteResult<{ id: UUID; deleted: true }>> {
  const loaded = await loadLine(admin, id);
  if (!loaded.ok) return loaded;
  const { line } = loaded;

  if (line.batch_id) {
    const batch = await batchOf(admin, line.batch_id);
    if (batch) {
      if (!isEditable(batch.status)) return fail(409, `Batch '${batch.batch_number}' ${NOT_EDITABLE}`);
      if (batch.status === "in_production") {
        const { count, error } = await admin
          .from("order_factory_category")
          .select("id", { count: "exact", head: true })
          .eq("batch_id", batch.id)
          .neq("id", id);
        if (error) return fail(500, error.message);
        if (!count) {
          return fail(
            409,
            "A batch In Production needs at least one Factory x Category entry. Move the batch back to In Negotiation first."
          );
        }
      }
    }
  }

  // Linha que já embarcou (snapshot de um Shipment) não sai: o delete em
  // cascata levaria junto o registro do que foi carregado, e desfazer aquele
  // embarque (delete_shipment) depende dele.
  const { count: shipped, error: shippedError } = await admin
    .from("shipment_loaded_lines")
    .select("id", { count: "exact", head: true })
    .eq("order_factory_category_id", id);
  if (shippedError) return fail(500, shippedError.message);
  if (shipped) return fail(409, "This item was loaded in a shipment and can't be deleted.");

  const { error } = await admin.from("order_factory_category").delete().eq("id", id);
  if (error) return fail(500, error.message);

  const statusError = await syncOrderStatus(admin, [line.order_id]);
  if (statusError) return fail(500, statusError);
  await refreshViews(line.order_id);
  return { ok: true, status: 200, data: { id, deleted: true } };
}
