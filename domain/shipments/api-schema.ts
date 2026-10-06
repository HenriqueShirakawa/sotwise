import { z } from "zod";

import { apiDay, apiInstantQuery } from "@/lib/api-dates";
import { PRELOADING_STEPS, SHIPMENT_STEPS } from "@/lib/checklist";
import type { ChecklistStep } from "@/types/database";

/**
 * Contrato da API REST de PL + SHIPMENT (`/api/shipments`) — UM recurso só,
 * como o `/v1/shipments/` do GSS (decisão do usuário, 06/10): o Pre-loading e
 * o embarque que nasce dele no Confirm Shipping são o mesmo registro, chaveado
 * pelo `pl_number`.
 *
 *  - referências de biblioteca (clients, pod, carrier, shipment_model e os
 *    cadastros das etapas) aceitam o UUID do SOTWISE OU o `gss_id`;
 *  - pessoas vão por e-mail (como em /api/orders);
 *  - lotes por UUID ou `full_number` ("1230.02").
 */

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

/** UUID ou gss_id (o GSS manda inteiro; guardamos texto). */
const ref = z
  .union([z.string().trim().min(1), z.number().int().nonnegative()])
  .transform((v) => String(v));

const gssId = ref;
const email = (label: string) => z.email(`Invalid ${label} e-mail.`);
const batchKeys = z.array(z.string().trim().min(1)).max(200, "At most 200 batches.");

export const SHIPMENT_STATUSES = ["preloading", "in_transit", "delivered"] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** `POST /api/shipments` = Create PL. */
export const createShipmentSchema = z.strictObject({
  gss_id: gssId.optional(),
  clients: z.array(ref).min(1, "Send at least one client."),
  client_reference: z.string().trim().min(1, "client_reference is required.").max(200),
  pod: ref,
  leader_email: email("leader"),
  responsible_signer_email: email("responsible signer").nullish(),
  batch_ids: batchKeys.default([]),
});

export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;

const LOADING_STATUSES = ["none", "partial", "total"] as const;

/** Dados do Confirm Shipping (popup da tela). */
const confirmSchema = z.strictObject({
  container_number: z.string().trim().min(1, "container_number is required."),
  seal_number: z.string().trim().min(1, "seal_number is required."),
  estimated_date: apiDay,
  loading_date_completed_on: apiDay,
  carrier: ref,
  shipment_model: ref,
  shipment_leader_email: email("shipment leader"),
  signer_email: email("signer"),
  /** Default: o leader do PL. */
  preloading_leader_email: email("pre-loading leader").optional(),
  lines: z
    .array(
      z.strictObject({
        item_id: z.uuid("item_id must be a UUID."),
        loading_status: z.enum(LOADING_STATUSES),
      })
    )
    .min(1, "Send the loading status of every line."),
});

export type ConfirmInput = z.infer<typeof confirmSchema>;

const HEADER_KEYS = [
  "gss_id",
  "clients",
  "client_reference",
  "pod",
  "leader_email",
  "responsible_signer_email",
  "batch_ids",
] as const;

/**
 * `PATCH /api/shipments/{id}`. Cabeçalho/lotes só enquanto o PL não embarcou;
 * `status` faz as transições: `in_transit` (+ `confirm`) = Confirm Shipping,
 * `preloading` = desfaz o embarque. `delivered` vem da etapa Delivered.
 */
export const patchShipmentSchema = z
  .strictObject({
    gss_id: gssId.nullable().optional(),
    clients: z.array(ref).min(1, "Send at least one client.").optional(),
    client_reference: z.string().trim().min(1).max(200).optional(),
    pod: ref.optional(),
    leader_email: email("leader").optional(),
    responsible_signer_email: email("responsible signer").nullable().optional(),
    batch_ids: batchKeys.optional(),
    status: z
      .enum(["in_transit", "preloading"], {
        error:
          "status can be 'in_transit' (Confirm Shipping, with 'confirm') or 'preloading' (undo the shipment). 'delivered' comes from the Delivered step.",
      })
      .optional(),
    confirm: confirmSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "No fields to update." })
  .refine((v) => (v.status === "in_transit") === (v.confirm !== undefined), {
    message: "'confirm' is required with status 'in_transit' (and only with it).",
    path: ["confirm"],
  })
  .refine((v) => v.status === undefined || HEADER_KEYS.every((k) => v[k] === undefined), {
    message: "Change the status in its own request (no header fields together).",
    path: ["status"],
  });

export type PatchShipmentInput = z.infer<typeof patchShipmentSchema>;

/** Etapas do checklist único do PL (7 do Pre-loading + 7 do Shipment). */
export const PL_CHECKLIST_STEPS = [...PRELOADING_STEPS, ...SHIPMENT_STEPS] as ChecklistStep[];

const optionalRef = ref.nullable().optional();

/**
 * `PATCH /api/shipments/{id}/steps/{step}`. Campos comuns + os cadastros de
 * cada etapa (só os da própria etapa são aceitos — ver STEP_FIELDS).
 */
export const patchStepSchema = z
  .strictObject({
    estimated_date: apiDay.nullable().optional(),
    completed_on: apiDay.nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    responsible_email: email("responsible").nullable().optional(),
    consolidation_point: optionalRef,
    city: optionalRef,
    pol: optionalRef,
    carrier: optionalRef,
    agent_brazil: optionalRef,
    agent_china: optionalRef,
    contact_brazil: optionalRef,
    contact_china: optionalRef,
    booking_number: z.string().trim().max(100).nullable().optional(),
    cutoff_date: apiDay.nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "No fields to update." });

export type PatchStepInput = z.infer<typeof patchStepSchema>;

/** Campos específicos que cada etapa aceita (os da tela). */
export const STEP_FIELDS: Partial<Record<ChecklistStep, (keyof PatchStepInput)[]>> = {
  consolidation_point: ["consolidation_point"],
  city: ["city"],
  port_of_loading: ["pol"],
  agents: ["carrier", "agent_brazil", "agent_china", "contact_brazil", "contact_china"],
  booking: ["booking_number", "cutoff_date"],
};

export const COMMON_STEP_FIELDS: (keyof PatchStepInput)[] = [
  "estimated_date",
  "completed_on",
  "notes",
  "responsible_email",
];

export const shipmentQuerySchema = z.object({
  pl_number: z.string().trim().min(1).optional(),
  po_number: z.string().trim().min(1).optional(),
  status: z.enum(SHIPMENT_STATUSES).optional(),
  updated_since: apiInstantQuery.optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ShipmentQuery = z.infer<typeof shipmentQuerySchema>;

const QUERY_KEYS = ["pl_number", "po_number", "status", "updated_since", "order", "limit", "offset"] as const;

export function parseShipmentQuery(params: URLSearchParams) {
  const raw: Record<string, string> = {};
  for (const key of QUERY_KEYS) {
    const value = params.get(key);
    if (value !== null && value !== "") raw[key] = value;
  }
  return shipmentQuerySchema.safeParse(raw);
}
