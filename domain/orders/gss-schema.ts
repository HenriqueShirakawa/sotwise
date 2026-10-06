import { z } from "zod";

import { apiDay } from "@/lib/api-dates";

/** Unix (s) ou "YYYY-MM-DD" (legado) → "YYYY-MM-DD"; omitido/null passam. */
const optionalDate = apiDay.nullish();

/** gss_id de uma biblioteca (traduzido para o UUID interno no endpoint). */
const optionalGssRef = z.string().trim().min(1).nullish();

/**
 * Uma linha Factory×Category da order. O GSS a identifica pelo `gss_id` do
 * supplier-category (= `factory_products.gss_id`), do qual o endpoint deriva a
 * fábrica e a categoria. `ship_requirement` é obrigatória por linha; a linha
 * nasce SEM lote (batch) — o usuário atribui o lote depois no SOTWISE.
 */
const gssOrderItemSchema = z.object({
  supplier_category_gss_id: z
    .string()
    .trim()
    .min(1, "supplier_category_gss_id is required."),
  ship_requirement: apiDay,
});

export type GssOrderItemInput = z.infer<typeof gssOrderItemSchema>;

/**
 * Payload que o GSS manda em POST /api/orders para criar/atualizar uma
 * order (via inbound push — oposta ao pull das bibliotecas).
 *
 * As FKs vêm pelo `gss_id` da biblioteca correspondente (não pelo UUID interno):
 * o endpoint resolve cada `*_gss_id` para o UUID via a coluna `gss_id` já
 * existente nas libs. `gss_id` (do pedido) é a chave natural que torna o POST
 * idempotente. `po_number` é decisão do GSS (unique no banco — colisão vira 409).
 */
export const gssOrderSchema = z.object({
  gss_id: z.string().trim().min(1, "gss_id is required."),
  // Obrigatório na CRIAÇÃO (validado no endpoint); no reenvio pode ser omitido —
  // a order é identificada pelo gss_id, não pelo po_number.
  po_number: z
    .string()
    .trim()
    .min(1, "po_number cannot be empty.")
    .max(50, "po_number is too long.")
    .optional(),
  order_type_gss_id: optionalGssRef,
  client_gss_id: optionalGssRef,
  business_unit_gss_id: optionalGssRef,
  exporter_gss_id: optionalGssRef,
  schedule_requested: optionalDate,
  client_reference: z.string().trim().max(200, "Reference is too long.").nullish(),
  date_po: optionalDate,
  // Leader/Requester são usuários do SOTWISE (profiles). Profiles não têm gss_id,
  // então o GSS os identifica pelo e-mail — resolvido para o id do profile no
  // endpoint via public.profile_id_by_email().
  leader_email: z.email("Invalid leader e-mail.").nullish(),
  requester_email: z.email("Invalid requester e-mail.").nullish(),
  operational_responsible_email: z.email("Invalid operational responsible e-mail.").nullish(),
  // Linhas Factory×Category da order (order_factory_category). Opcional: pode
  // vir vazio ou omitido. Ver gssOrderItemSchema.
  items: z.array(gssOrderItemSchema).nullish(),
});

export type GssOrderInput = z.infer<typeof gssOrderSchema>;

/**
 * `PATCH /api/orders/{id}` — só o cabeçalho, parcial (o que vier é aplicado;
 * `null` limpa). `po_number`, `gss_id` e `status` não mudam por aqui (número
 * imutável, chave do GSS, status é rollup dos lotes); linhas têm recurso
 * próprio (/api/order-items). Campo desconhecido → 400.
 */
export const gssOrderPatchSchema = gssOrderSchema
  .omit({ gss_id: true, po_number: true, items: true })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "No fields to update.",
  });

export type GssOrderPatchInput = z.infer<typeof gssOrderPatchSchema>;

/** Campos de cabeçalho comuns ao POST (upsert) e ao PATCH. */
export type GssOrderHeaderInput = Omit<GssOrderInput, "gss_id" | "po_number" | "items">;
