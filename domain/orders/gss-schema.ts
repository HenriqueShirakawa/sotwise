import { z } from "zod";

/** "YYYY-MM-DD" ou omitido/null. */
const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD.")
  .nullish();

/** gss_id de uma biblioteca (traduzido para o UUID interno no endpoint). */
const optionalGssRef = z.string().trim().min(1).nullish();

/**
 * Payload que o GSS manda em POST /api/gss/orders para criar/atualizar uma
 * order (via inbound push — oposta ao pull das bibliotecas).
 *
 * As FKs vêm pelo `gss_id` da biblioteca correspondente (não pelo UUID interno):
 * o endpoint resolve cada `*_gss_id` para o UUID via a coluna `gss_id` já
 * existente nas libs. `gss_id` (do pedido) é a chave natural que torna o POST
 * idempotente. `po_number` é decisão do GSS (unique no banco — colisão vira 409).
 */
export const gssOrderSchema = z.object({
  gss_id: z.string().trim().min(1, "gss_id is required."),
  po_number: z
    .string()
    .trim()
    .min(1, "po_number is required.")
    .max(50, "po_number is too long."),
  order_type_gss_id: optionalGssRef,
  client_gss_id: optionalGssRef,
  business_unit_gss_id: optionalGssRef,
  exporter_gss_id: optionalGssRef,
  schedule_requested: optionalDate,
  client_reference: z.string().trim().max(200, "Reference is too long.").nullish(),
  date_po: optionalDate,
});

export type GssOrderInput = z.infer<typeof gssOrderSchema>;
