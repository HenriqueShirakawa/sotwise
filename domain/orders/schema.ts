import { z } from "zod";

/** UUID de FK opcional — aceita string uuid ou null (campo não preenchido). */
const optionalFk = z.string().uuid().nullable();

/**
 * Schema de um pedido (Create/Edit). `po_number` é auto-gerado e não editável
 * (constraint `unique` no banco); na criação vem o próximo número, na edição
 * o número atual — em ambos read-only no form. `status` não entra aqui: novo
 * pedido nasce `in_negotiation` (default do banco) e depois é rollup dos lotes.
 */
export const orderSchema = z.object({
  po_number: z
    .string()
    .trim()
    .min(1, "Order number is required.")
    .max(50, "Order number is too long."),
  order_type_id: optionalFk,
  schedule_requested: z.string().min(1).nullable(), // "YYYY-MM-DD" ou null
  client_id: optionalFk,
  client_reference: z.string().trim().max(200, "Reference is too long.").nullable(),
  business_unit_id: optionalFk,
  requester_id: optionalFk,
  exporter_id: optionalFk,
  leader_id: optionalFk,
});

export type OrderInput = z.infer<typeof orderSchema>;

export type ActionResult = { ok: true } | { ok: false; error: string };
