import { z } from "zod";

import { apiDay, apiInstantQuery } from "@/lib/api-dates";

/**
 * Contrato da API REST das linhas FACTORY × CATEGORY (`/api/order-items`) —
 * a tabela `order_factory_category`. O `id` é o mesmo que já aparece em
 * `GET /api/orders?include=items` e em `items[]` dos lotes.
 *
 * A linha nasce numa order (pela chave do GSS `order_gss_id` ou `po_number`),
 * identificada pelo `supplier_category_gss_id` (→ factory_products → fábrica +
 * categoria) — o mesmo formato do `items[]` do POST /api/orders. Lote é
 * opcional. O ETD da linha tem rota própria: PATCH /api/etd-factories/{id}.
 */

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

const gssRef = z
  .union([z.string().trim().min(1), z.number().int().nonnegative()])
  .transform((v) => String(v));

/** Lote: UUID ou full_number ("1230.02"); resolvido na escrita. */
const batchRef = z.string().trim().min(1, "batch_id cannot be empty.");

export const createOrderItemSchema = z
  .strictObject({
    order_gss_id: gssRef.optional(),
    po_number: z.string().trim().min(1).optional(),
    supplier_category_gss_id: gssRef,
    ship_requirement: apiDay,
    batch_id: batchRef.optional(),
  })
  .refine((v) => (v.order_gss_id ? 1 : 0) + (v.po_number ? 1 : 0) === 1, {
    message: "Send exactly one of 'order_gss_id' or 'po_number' to identify the order.",
    path: ["order_gss_id"],
  });

export type CreateOrderItemInput = z.infer<typeof createOrderItemSchema>;

/**
 * `PATCH /api/order-items/{id}` — parcial. `batch_id` move a linha (null = tira
 * do lote); fábrica/categoria não mudam (apague e crie outra). `loading_status`
 * é do Confirm Shipping, não se grava aqui.
 */
export const updateOrderItemSchema = z
  .strictObject({
    batch_id: batchRef.nullable().optional(),
    ship_requirement: apiDay.optional(),
  })
  .refine((v) => v.batch_id !== undefined || v.ship_requirement !== undefined, {
    message: "No fields to update.",
  });

export type UpdateOrderItemInput = z.infer<typeof updateOrderItemSchema>;

export const orderItemQuerySchema = z.object({
  po_number: z.string().trim().min(1).optional(),
  order_gss_id: z.string().trim().min(1).optional(),
  batch_id: z.string().trim().min(1).optional(),
  unassigned: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  updated_since: apiInstantQuery.optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

export type OrderItemQuery = z.infer<typeof orderItemQuerySchema>;

const QUERY_KEYS = [
  "po_number",
  "order_gss_id",
  "batch_id",
  "unassigned",
  "updated_since",
  "order",
  "limit",
  "offset",
] as const;

/** Só as chaves conhecidas viram query — o resto da query string é ignorado. */
export function parseOrderItemQuery(params: URLSearchParams) {
  const raw: Record<string, string> = {};
  for (const key of QUERY_KEYS) {
    const value = params.get(key);
    if (value !== null && value !== "") raw[key] = value;
  }
  return orderItemQuerySchema.safeParse(raw);
}
