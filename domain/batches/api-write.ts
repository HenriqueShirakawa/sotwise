import "server-only";

import { revalidatePath } from "next/cache";

import { broadcastEtdPing } from "@/lib/etd-realtime";
import { syncOrderStatus } from "@/lib/order-status";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { BatchStatus } from "@/types/database";
import { fail, type Fail, type WriteResult } from "@/domain/api/write-result";

import { findOrderRef, getBatch, type BatchRead } from "./api-read";
import {
  EDITABLE_BATCH_STATUSES,
  type CreateBatchInput,
  type NewBatchItemInput,
  type UpdateBatchInput,
} from "./api-schema";

/**
 * Escrita de LOTES pela API (POST/PATCH/DELETE /api/batches). Espelha as
 * travas das actions da tela da Order (app/(dashboard)/orders/[id]/actions.ts):
 *
 *  - lote só é editável em In Negotiation / In Production (daí pra frente é do
 *    fluxo de PL/Shipment) — e isso vale também para o lote de ONDE uma linha
 *    sai ao ser movida (a tela só checa o destino; a API é mais estrita);
 *  - a mesma Category + Factory não repete no lote ("gêmeas", lib/ofc-twins);
 *  - lote In Production nunca fica sem linha (nem o destino, nem a origem);
 *  - lote novo nasce In Negotiation e só muda pelo `status` do PATCH (a
 *    promoção automática pelo Deposit Payment ainda não existe na main);
 *  - toda escrita refaz o rollup de status da Order (syncOrderStatus, que já
 *    dispara aviso ao cliente e ping realtime) e revalida as telas.
 *
 * Tudo é validado ANTES da primeira escrita: o PostgREST não dá transação, então
 * o que pode falhar por regra falha cedo, sem deixar meio caminho gravado.
 */

type AdminClient = ReturnType<typeof createAdminClient>;
type UUID = string;

export type { WriteResult };

const isEditable = (status: BatchStatus) =>
  (EDITABLE_BATCH_STATUSES as readonly BatchStatus[]).includes(status);

const NOT_EDITABLE =
  "can only be changed while In Negotiation or In Production (later statuses are driven by the Pre-loading/Shipment flow).";

type Line = { id: UUID; batch_id: UUID | null; factory_id: UUID; category_id: UUID };
type NewLine = { factory_id: UUID; category_id: UUID; ship_requirement: string };

const pairKey = (l: { factory_id: UUID; category_id: UUID }) => `${l.category_id}|${l.factory_id}`;

/** Mesmo efeito de `revalidateBatchViews` das actions da Order. */
async function refreshViews(orderId: UUID) {
  revalidatePath("/orders/[id]", "page");
  revalidatePath("/orders");
  revalidatePath("/pre-loading");
  revalidatePath("/etd-factories");
  await broadcastEtdPing({ order_ids: [orderId] });
}

/** `supplier_category_gss_id` → fábrica + categoria (factory_products), como no POST de orders. */
async function resolveNewItems(
  admin: AdminClient,
  items: NewBatchItemInput[] | undefined
): Promise<{ ok: true; lines: NewLine[] } | Fail> {
  const lines: NewLine[] = [];
  for (const item of items ?? []) {
    const { data, error } = await admin
      .from("factory_products")
      .select("factory_id, category_id")
      .eq("gss_id", item.supplier_category_gss_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return fail(500, error.message);
    if (!data) {
      return fail(
        400,
        `No factory_products found for supplier_category_gss_id '${item.supplier_category_gss_id}'.`
      );
    }
    lines.push({
      factory_id: data.factory_id,
      category_id: data.category_id,
      ship_requirement: item.ship_requirement,
    });
  }
  return { ok: true, lines };
}

/**
 * Linhas existentes que vão ENTRAR no lote `targetId` (null = lote ainda não
 * criado). Precisam ser da mesma order; as que já estão no alvo são ignoradas.
 * Checa a origem: lote editável e, se In Production, que não fique vazio.
 */
async function loadIncomingLines(
  admin: AdminClient,
  orderId: UUID,
  itemIds: UUID[] | undefined,
  targetId: UUID | null
): Promise<{ ok: true; lines: Line[] } | Fail> {
  const ids = [...new Set(itemIds ?? [])];
  if (ids.length === 0) return { ok: true, lines: [] };

  const { data, error } = await admin
    .from("order_factory_category")
    .select("id, order_id, batch_id, factory_id, category_id")
    .in("id", ids);
  if (error) return fail(500, error.message);
  const found = new Map((data ?? []).map((l) => [l.id, l]));
  for (const id of ids) {
    const line = found.get(id);
    if (!line || line.order_id !== orderId) {
      return fail(400, `Item '${id}' not found in this order.`);
    }
  }

  // Lote ainda não criado (targetId null): toda linha entra — inclusive as sem
  // lote, que senão casariam `null === null` e seriam descartadas.
  const incoming = ids
    .map((id) => found.get(id)!)
    .filter((l) => targetId === null || l.batch_id !== targetId);
  const sourceIds = [
    ...new Set(incoming.map((l) => l.batch_id).filter((id): id is UUID => !!id)),
  ];
  if (sourceIds.length > 0) {
    const { data: sources, error: srcError } = await admin
      .from("batches")
      .select("id, batch_number, status")
      .in("id", sourceIds);
    if (srcError) return fail(500, srcError.message);

    for (const src of sources ?? []) {
      if (!isEditable(src.status)) {
        return fail(409, `Item comes from batch '${src.batch_number}', which ${NOT_EDITABLE}`);
      }
      if (src.status !== "in_production") continue;
      const leaving = incoming.filter((l) => l.batch_id === src.id).length;
      const { count, error: countError } = await admin
        .from("order_factory_category")
        .select("id", { count: "exact", head: true })
        .eq("batch_id", src.id);
      if (countError) return fail(500, countError.message);
      if ((count ?? 0) - leaving <= 0) {
        return fail(
          409,
          `Batch '${src.batch_number}' is In Production and would be left without any Factory x Category entry. Move it back to In Negotiation first.`
        );
      }
    }
  }

  return {
    ok: true,
    lines: incoming.map((l) => ({
      id: l.id,
      batch_id: l.batch_id,
      factory_id: l.factory_id,
      category_id: l.category_id,
    })),
  };
}

/** A mesma Category + Factory não pode aparecer duas vezes no conteúdo final do lote. */
function twinError(finalContent: { factory_id: UUID; category_id: UUID }[]): string | null {
  const seen = new Set<string>();
  for (const l of finalContent) {
    const key = pairKey(l);
    if (seen.has(key)) return "The same Category + Factory can only appear once per batch.";
    seen.add(key);
  }
  return null;
}

/** Próximo ".NN" livre da order (o maior sufixo numérico + 1, não a contagem). */
async function nextBatchNumber(admin: AdminClient, orderId: UUID): Promise<string | Fail> {
  const { data, error } = await admin.from("batches").select("batch_number").eq("order_id", orderId);
  if (error) return fail(500, error.message);
  let max = 0;
  for (const b of data ?? []) {
    const m = /^\.(\d+)$/.exec(b.batch_number.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  max = Math.max(max, (data ?? []).length);
  return `.${String(max + 1).padStart(2, "0")}`;
}

/** Grava as linhas: novas nascem no lote, existentes mudam de lote. */
async function writeLines(
  admin: AdminClient,
  orderId: UUID,
  batchId: UUID,
  incoming: Line[],
  fresh: NewLine[]
): Promise<string | null> {
  if (fresh.length > 0) {
    const { error } = await admin.from("order_factory_category").insert(
      fresh.map((l) => ({ ...l, order_id: orderId, batch_id: batchId }))
    );
    if (error) return error.message;
  }
  if (incoming.length > 0) {
    const { error } = await admin
      .from("order_factory_category")
      .update({ batch_id: batchId })
      .in(
        "id",
        incoming.map((l) => l.id)
      );
    if (error) return error.message;
  }
  return null;
}

async function finish(
  admin: AdminClient,
  orderId: UUID,
  batchId: UUID,
  status: 200 | 201
): Promise<WriteResult<BatchRead>> {
  const statusError = await syncOrderStatus(admin, [orderId]);
  if (statusError) return fail(500, statusError);
  await refreshViews(orderId);
  const batch = await getBatch(admin, batchId);
  if (!batch) return fail(500, "Batch was saved but could not be read back.");
  return { ok: true, status, data: batch };
}

/** `batch_code` do GSS ("1667.01") → o nosso sufixo (".01") quando o prefixo é o po_number. */
function normalizeBatchNumber(poNumber: string, batchNumber: string | undefined): string | undefined {
  if (!batchNumber) return undefined;
  return batchNumber.startsWith(`${poNumber}.`) ? batchNumber.slice(poNumber.length) : batchNumber;
}

/**
 * Lote que um `gss_id` já representa aqui. Ordem: (1) já gravado com esse
 * gss_id; (2) lote da mesma order com o mesmo número e SEM gss_id — é adotado
 * (grava o gss_id nele): cobre lote que nasceu aqui antes (split, tela) e a
 * carga inicial. `batch: null` = ainda não existe, o POST cria.
 */
async function resolveGssBatch(
  admin: AdminClient,
  order: { id: UUID; po_number: string },
  gssId: string,
  batchNumber: string | undefined
): Promise<{ ok: true; batch: { id: UUID; batch_number: string } | null } | Fail> {
  const { data: known, error } = await admin
    .from("batches")
    .select("id, order_id, batch_number")
    .eq("gss_id", gssId)
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (known) {
    if (known.order_id !== order.id) {
      return fail(409, `gss_id '${gssId}' already belongs to a batch of another order.`);
    }
    return { ok: true, batch: known };
  }

  if (!batchNumber) return { ok: true, batch: null };
  const { data: same, error: sameError } = await admin
    .from("batches")
    .select("id, batch_number, gss_id")
    .eq("order_id", order.id)
    .eq("batch_number", batchNumber)
    .maybeSingle();
  if (sameError) return fail(500, sameError.message);
  if (!same) return { ok: true, batch: null };
  if (same.gss_id) {
    return fail(
      409,
      `batch_number '${batchNumber}' already exists in order ${order.po_number} with gss_id '${same.gss_id}'.`
    );
  }

  const { error: linkError } = await admin.from("batches").update({ gss_id: gssId }).eq("id", same.id);
  if (linkError) return fail(linkError.code === "23505" ? 409 : 500, linkError.message);
  return { ok: true, batch: { id: same.id, batch_number: same.batch_number } };
}

export async function createBatch(
  admin: AdminClient,
  input: CreateBatchInput
): Promise<WriteResult<BatchRead>> {
  const order = await findOrderRef(admin, input);
  if (!order) {
    return fail(
      400,
      input.order_gss_id
        ? `No order found for order_gss_id '${input.order_gss_id}'.`
        : `No order found for po_number '${input.po_number}'.`
    );
  }

  const requestedNumber = normalizeBatchNumber(order.po_number, input.batch_number);

  if (input.gss_id) {
    const existing = await resolveGssBatch(admin, order, input.gss_id, requestedNumber);
    if (!existing.ok) return existing;
    if (existing.batch) {
      const changes: UpdateBatchInput = {
        batch_number:
          requestedNumber && requestedNumber !== existing.batch.batch_number ? requestedNumber : undefined,
        item_ids: input.item_ids,
        items: input.items,
      };
      const nothingToApply =
        changes.batch_number === undefined && !changes.item_ids?.length && !changes.items?.length;
      if (nothingToApply) {
        // Reenvio do mesmo lote sem nada novo: devolve como está, sem exigir
        // lote editável (o webhook pode repetir depois do embarque).
        const batch = await getBatch(admin, existing.batch.id);
        return batch ? { ok: true, status: 200, data: batch } : fail(404, "Batch not found.");
      }
      return updateBatch(admin, existing.batch.id, changes);
    }
  }

  const fresh = await resolveNewItems(admin, input.items);
  if (!fresh.ok) return fresh;
  const incoming = await loadIncomingLines(admin, order.id, input.item_ids, null);
  if (!incoming.ok) return incoming;

  const twin = twinError([...incoming.lines, ...fresh.lines]);
  if (twin) return fail(409, twin);

  let batchNumber = requestedNumber;
  if (!batchNumber) {
    const next = await nextBatchNumber(admin, order.id);
    if (typeof next !== "string") return next;
    batchNumber = next;
  }

  const { data: batch, error } = await admin
    .from("batches")
    .insert({ order_id: order.id, batch_number: batchNumber, gss_id: input.gss_id ?? null })
    .select("id")
    .single();
  if (error || !batch) {
    if (error?.code === "23505") {
      return fail(
        409,
        input.gss_id
          ? `batch_number '${batchNumber}' or gss_id '${input.gss_id}' already exists.`
          : `batch_number '${batchNumber}' already exists in order ${order.po_number}.`
      );
    }
    return fail(500, error?.message ?? "Failed to create batch.");
  }

  const linesError = await writeLines(admin, order.id, batch.id, incoming.lines, fresh.lines);
  if (linesError) {
    // Desfaz o lote recém-criado. Insert e update são um statement cada (atômicos):
    // se o move falhou, o que tem esse batch_id são só as linhas NOVAS — saem junto.
    await admin.from("order_factory_category").delete().eq("batch_id", batch.id);
    await admin.from("batches").delete().eq("id", batch.id);
    return fail(500, linesError);
  }

  return finish(admin, order.id, batch.id, 201);
}

export async function updateBatch(
  admin: AdminClient,
  batchId: UUID,
  input: UpdateBatchInput
): Promise<WriteResult<BatchRead>> {
  const { data: batch, error } = await admin
    .from("batches")
    .select("id, order_id, batch_number, status")
    .eq("id", batchId)
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!batch) return fail(404, "Batch not found.");
  if (!isEditable(batch.status)) return fail(409, `Batch '${batch.batch_number}' ${NOT_EDITABLE}`);

  const { data: current, error: currentError } = await admin
    .from("order_factory_category")
    .select("id, batch_id, factory_id, category_id")
    .eq("batch_id", batchId);
  if (currentError) return fail(500, currentError.message);
  const currentLines = (current ?? []) as Line[];
  const currentIds = new Set(currentLines.map((l) => l.id));

  const removeIds = [...new Set(input.remove_item_ids ?? [])];
  for (const id of removeIds) {
    if (!currentIds.has(id)) return fail(400, `Item '${id}' is not in this batch.`);
  }

  const fresh = await resolveNewItems(admin, input.items);
  if (!fresh.ok) return fresh;
  const incoming = await loadIncomingLines(admin, batch.order_id, input.item_ids, batchId);
  if (!incoming.ok) return incoming;

  const removing = new Set(removeIds);
  const finalContent = [
    ...currentLines.filter((l) => !removing.has(l.id)),
    ...incoming.lines,
    ...fresh.lines,
  ];
  const twin = twinError(finalContent);
  if (twin) return fail(409, twin);

  const finalStatus = input.status ?? batch.status;
  if (finalStatus === "in_production" && finalContent.length === 0) {
    return fail(
      409,
      input.status === "in_production"
        ? "Add at least one Factory x Category entry before moving this batch to Production."
        : "A batch In Production needs at least one Factory x Category entry. Move the batch back to In Negotiation first."
    );
  }

  // 1º as colunas do lote: um batch_number repetido (409) falha antes de mexer nas linhas.
  const patch: { batch_number?: string; status?: BatchStatus } = {};
  if (input.batch_number !== undefined) patch.batch_number = input.batch_number;
  if (input.status !== undefined) patch.status = input.status;
  if (Object.keys(patch).length > 0) {
    const { error: updError } = await admin.from("batches").update(patch).eq("id", batchId);
    if (updError) {
      if (updError.code === "23505") {
        return fail(409, `batch_number '${input.batch_number}' already exists in this order.`);
      }
      return fail(500, updError.message);
    }
  }

  if (removeIds.length > 0) {
    const { error: rmError } = await admin
      .from("order_factory_category")
      .update({ batch_id: null })
      .in("id", removeIds);
    if (rmError) return fail(500, rmError.message);
  }

  const linesError = await writeLines(admin, batch.order_id, batchId, incoming.lines, fresh.lines);
  if (linesError) return fail(500, linesError);

  return finish(admin, batch.order_id, batchId, 200);
}

export async function deleteBatch(
  admin: AdminClient,
  batchId: UUID
): Promise<WriteResult<{ id: UUID; deleted: true; released_item_ids: UUID[] }>> {
  const { data: batch, error } = await admin
    .from("batches")
    .select("id, order_id, batch_number, status")
    .eq("id", batchId)
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!batch) return fail(404, "Batch not found.");
  if (!isEditable(batch.status)) return fail(409, `Batch '${batch.batch_number}' ${NOT_EDITABLE}`);

  // As linhas sobrevivem sem lote (FK `on delete set null`) — mesmo efeito da lixeira da tela.
  const { data: lines, error: linesError } = await admin
    .from("order_factory_category")
    .select("id")
    .eq("batch_id", batchId);
  if (linesError) return fail(500, linesError.message);

  const { error: delError } = await admin.from("batches").delete().eq("id", batchId);
  if (delError) return fail(500, delError.message);

  const statusError = await syncOrderStatus(admin, [batch.order_id]);
  if (statusError) return fail(500, statusError);
  await refreshViews(batch.order_id);

  return {
    ok: true,
    status: 200,
    data: { id: batchId, deleted: true, released_item_ids: (lines ?? []).map((l) => l.id) },
  };
}
