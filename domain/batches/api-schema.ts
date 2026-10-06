import { z } from "zod";

import { apiDay, apiInstantQuery } from "@/lib/api-dates";
import { isUuid } from "@/domain/api/write-result";
import type { BatchStatus } from "@/types/database";

/**
 * Contrato da API REST de LOTES (`/api/batches`) — consumida pelo GSS.
 *
 * O lote é sempre de UMA order; o GSS aponta a order pela mesma chave que já
 * usa no POST /api/orders (`order_gss_id`) ou pelo `po_number`. As linhas
 * Factory×Category entram no lote de dois jeitos:
 *   - `item_ids`: linhas que JÁ existem na order (o `id` que o
 *     GET /api/orders?include=items devolve) — são MOVIDAS para o lote;
 *   - `items`: linhas novas, identificadas pelo `supplier_category_gss_id`
 *     (mesmo formato do `items[]` do POST /api/orders) — nascem no lote.
 *
 * Status só transita entre `in_negotiation` e `in_production` (o mesmo seletor
 * da tela da Order); daí pra frente quem move o lote é o fluxo de Pre-loading/
 * Shipment. Ver docs/regras_de_negocio.md §6.6.
 */

/** Valores de `batches.status` — a lista em runtime que o tipo não dá. */
export const BATCH_STATUSES = [
  "in_negotiation",
  "in_production",
  "preloading",
  "in_transit",
  "delivered",
  "canceled",
] as const satisfies readonly BatchStatus[];

/** Únicos status que a API (e a tela) gravam; também é quando o lote é editável. */
export const EDITABLE_BATCH_STATUSES = [
  "in_negotiation",
  "in_production",
] as const satisfies readonly BatchStatus[];

export const MAX_LIMIT = 200;
export const DEFAULT_LIMIT = 50;
/** Teto de linhas por chamada de escrita — protege o request de virar lote de importação. */
const MAX_ITEMS = 500;

export { isUuid };

const uuid = z.string().refine(isUuid, "Must be a UUID.");

const batchNumber = z
  .string()
  .trim()
  .min(1, "batch_number cannot be empty.")
  .max(20, "batch_number is too long.");

const editableStatus = z.enum(EDITABLE_BATCH_STATUSES, {
  error:
    "status can only be set to 'in_negotiation' or 'in_production'. " +
    "The other statuses are driven by the Pre-loading/Shipment flow.",
});

/** Linha Factory×Category NOVA — mesmo formato do `items[]` do POST /api/orders. */
const newItemSchema = z.object({
  supplier_category_gss_id: z.string().trim().min(1, "supplier_category_gss_id is required."),
  ship_requirement: apiDay,
});

export type NewBatchItemInput = z.infer<typeof newItemSchema>;

/** Id do GSS: eles mandam inteiro; guardamos como texto (padrão dos `gss_id`). */
const gssRef = z
  .union([z.string().trim().min(1), z.number().int().nonnegative()])
  .transform((v) => String(v));

const itemIds = z.array(uuid).max(MAX_ITEMS, `At most ${MAX_ITEMS} items per request.`);
const newItems = z.array(newItemSchema).max(MAX_ITEMS, `At most ${MAX_ITEMS} items per request.`);

/**
 * `POST /api/batches`. Campos desconhecidos → 400 (evita "mandei status e nada
 * aconteceu"). É também o WEBHOOK do GSS (decisão de 05/10: o lote nasce lá):
 * com `gss_id`, o POST é idempotente — reenvio do mesmo lote atualiza em vez de
 * duplicar (ver `createBatch`).
 */
export const createBatchSchema = z
  .strictObject({
    gss_id: gssRef.optional(),
    order_gss_id: gssRef.optional(),
    po_number: z.string().trim().min(1).optional(),
    batch_number: batchNumber.optional(),
    item_ids: itemIds.optional(),
    items: newItems.optional(),
  })
  .refine((v) => (v.order_gss_id ? 1 : 0) + (v.po_number ? 1 : 0) === 1, {
    message: "Send exactly one of 'order_gss_id' or 'po_number' to identify the order.",
    path: ["order_gss_id"],
  });

export type CreateBatchInput = z.infer<typeof createBatchSchema>;

/** `PATCH /api/batches/{id}` — parcial: só o que vier é aplicado. */
export const updateBatchSchema = z
  .strictObject({
    batch_number: batchNumber.optional(),
    status: editableStatus.optional(),
    item_ids: itemIds.optional(),
    items: newItems.optional(),
    remove_item_ids: itemIds.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "No fields to update.",
  })
  .refine(
    (v) => {
      const moving = new Set(v.item_ids ?? []);
      return !(v.remove_item_ids ?? []).some((id) => moving.has(id));
    },
    { message: "The same item cannot be in both 'item_ids' and 'remove_item_ids'.", path: ["remove_item_ids"] }
  );

export type UpdateBatchInput = z.infer<typeof updateBatchSchema>;

/** Query do `GET /api/batches`. Tudo opcional; sem filtro = página mais recente. */
export const batchQuerySchema = z.object({
  gss_id: z.string().trim().min(1).optional(),
  order_gss_id: z.string().trim().min(1).optional(),
  po_number: z.string().trim().min(1).optional(),
  status: z.enum(BATCH_STATUSES).optional(),
  updated_since: apiInstantQuery.optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

export type BatchQuery = z.infer<typeof batchQuerySchema>;

const QUERY_KEYS = [
  "gss_id",
  "order_gss_id",
  "po_number",
  "status",
  "updated_since",
  "order",
  "limit",
  "offset",
] as const;

/** Só as chaves conhecidas viram query — o resto da query string é ignorado. */
export function parseBatchQuery(params: URLSearchParams) {
  const raw: Record<string, string> = {};
  for (const key of QUERY_KEYS) {
    const value = params.get(key);
    if (value !== null && value !== "") raw[key] = value;
  }
  return batchQuerySchema.safeParse(raw);
}
