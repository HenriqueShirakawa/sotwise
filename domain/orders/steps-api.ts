import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { apiDay, dayToUnix } from "@/lib/api-dates";
import {
  recordFxcDelivery,
  recordPiStatus,
  setOrderReceivedDate,
  type GssUser,
} from "@/lib/checklist-revisions";
import { todayIso } from "@/lib/format";
import { broadcastOrderStatusPing } from "@/lib/orders-realtime";
import type { createAdminClient } from "@/lib/supabase/admin";
import { fail, type WriteResult } from "@/domain/api/write-result";
import type { ChecklistRevisionKind, ChecklistRevisionSource, ChecklistStep } from "@/types/database";

import { applyOrderItems } from "./api-write";
import { gssOrderItemSchema } from "./gss-schema";

/**
 * Etapas do checklist da ORDER que o GSS atualiza pela API (22/10/2026):
 *
 *   GET   /api/orders/{id}/steps/{step}   → estado da etapa + revisões
 *   PATCH /api/orders/{id}/steps/{step}   → o dado que conclui a etapa
 *
 * `{step}`: `order` (Order received date), `pi` (status da PI + data) e `po`
 * (leva de Factory × Category — desde 11/11/2026 NÃO conclui o PO sozinha: o
 * usuário grava o "PO received date" na tela; o GET mostra a data). As regras são as das telas (lib/checklist-
 * revisions): o 1º dado conclui a etapa, os seguintes viram revisões com motivo
 * (`reason`; sem ele, "Updated by GSS"), e o Completed on é sempre a ÚLTIMA
 * atualização — nunca se grava à mão. O toggle das etapas fica só na tela.
 */

type AdminClient = ReturnType<typeof createAdminClient>;
type UUID = string;
type Unix = number;

export const ORDER_API_STEPS = ["order", "pi", "po"] as const;
export type OrderApiStep = (typeof ORDER_API_STEPS)[number];

export const isOrderApiStep = (s: string): s is OrderApiStep =>
  (ORDER_API_STEPS as readonly string[]).includes(s);

const reason = z.string().trim().max(500, "reason is too long.").optional();

/**
 * Quem fez a mudança no GSS (09/11/2026) — aparece no History da etapa como
 * "Nome (GSS)". Texto (nome ou e-mail) ou `{ name, email }`. Opcional.
 */
const changedBy = z
  .union([
    z.string().trim().min(1).max(200),
    z.strictObject({
      name: z.string().trim().max(200).optional(),
      email: z.string().trim().max(200).optional(),
    }),
  ])
  .optional();

/** `changed_by` da API → `{ name, email }` (null quando não veio nada útil). */
export function normalizeChangedBy(raw: unknown): GssUser | null {
  if (typeof raw === "string") {
    const v = raw.trim();
    if (!v) return null;
    return v.includes("@") ? { name: null, email: v.toLowerCase() } : { name: v, email: null };
  }
  if (raw && typeof raw === "object") {
    const { name, email } = raw as { name?: string; email?: string };
    const n = name?.trim() || null;
    const e = email?.trim().toLowerCase() || null;
    return n || e ? { name: n, email: e } : null;
  }
  return null;
}

/** Corpo do PATCH de cada etapa — campo desconhecido → 400. */
export const orderStepPatchSchemas = {
  order: z.strictObject({ order_received_date: apiDay, reason, changed_by: changedBy }),
  pi: z.strictObject({
    /** true = PI emitida (conclui a etapa); false = ainda não (só grava). */
    pi_status: z.boolean({ error: "pi_status must be true or false." }),
    /** Ausente → hoje. */
    pi_status_date: apiDay.optional(),
    reason,
    /** Usuário do GSS que mudou o status — vai pro History da etapa PI. */
    changed_by: changedBy,
  }),
  po: z.strictObject({
    /** Linhas Factory × Category — as novas entram; as que já existem ficam. */
    items: z.array(gssOrderItemSchema).min(1, "Send at least one item."),
    reason,
    changed_by: changedBy,
  }),
} satisfies Record<OrderApiStep, z.ZodType>;

export type OrderStepRevisionRead = {
  kind: ChecklistRevisionKind;
  previous_date: Unix | null;
  new_date: Unix | null;
  payload: Record<string, unknown>;
  reason: string | null;
  source: ChecklistRevisionSource;
  changed_at: string;
};

export type OrderStepRead = {
  step: OrderApiStep;
  enabled: boolean;
  estimated_date: Unix | null;
  /** O dia da última atualização do dado da etapa (null = ainda aberta). */
  completed_on: Unix | null;
  done: boolean;
  /** O dado vigente da etapa. */
  order_received_date?: Unix | null;
  pi_status?: boolean | null;
  pi_status_date?: Unix | null;
  /** PO: a data gravada pelo usuário no SOT ("Set date", 11/11/2026). */
  po_received_date?: Unix | null;
  /** PO: as Factory × Category ativas da order. */
  items?: { id: UUID; factory: string; category: string; ship_requirement: Unix | null }[];
  /** Mais antigo primeiro; o 1º de cada tipo é o registro original. */
  revisions: OrderStepRevisionRead[];
};

/** Estado de uma etapa (formato do GET e da resposta do PATCH). */
export async function readOrderStep(
  admin: AdminClient,
  orderId: UUID,
  step: OrderApiStep
): Promise<OrderStepRead | null> {
  const { data: row, error } = await admin
    .from("order_checklist_steps")
    .select("id, enabled, estimated_date, completed_on, done")
    .eq("order_id", orderId)
    .eq("step", step as ChecklistStep)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;

  const { data: revs, error: revError } = await admin
    .from("checklist_step_revisions")
    .select("kind, previous_date, new_date, payload, reason, source, changed_at")
    .eq("step_id", row.id)
    .order("changed_at", { ascending: true });
  if (revError) throw new Error(revError.message);

  const out: OrderStepRead = {
    step,
    enabled: row.enabled,
    estimated_date: dayToUnix(row.estimated_date),
    completed_on: dayToUnix(row.completed_on),
    done: !!row.completed_on,
    revisions: (revs ?? []).map((r) => ({
      kind: r.kind,
      previous_date: dayToUnix(r.previous_date),
      new_date: dayToUnix(r.new_date),
      payload: r.payload,
      reason: r.reason,
      source: r.source,
      changed_at: r.changed_at,
    })),
  };

  if (step === "order" || step === "pi") {
    const { data: order, error: oError } = await admin
      .from("orders")
      .select("order_received_date, pi_status, pi_status_date")
      .eq("id", orderId)
      .maybeSingle();
    if (oError) throw new Error(oError.message);
    if (step === "order") out.order_received_date = dayToUnix(order?.order_received_date ?? null);
    else {
      out.pi_status = order?.pi_status ?? null;
      out.pi_status_date = dayToUnix(order?.pi_status_date ?? null);
    }
  } else {
    const { data: order, error: oError } = await admin
      .from("orders")
      .select("po_received_date")
      .eq("id", orderId)
      .maybeSingle();
    if (oError) throw new Error(oError.message);
    out.po_received_date = dayToUnix(order?.po_received_date ?? null);
    const { data: lines, error: lError } = await admin
      .from("order_factory_category")
      .select("id, ship_requirement, factories(name), categories(name)")
      .eq("order_id", orderId)
      .eq("is_active", true)
      .returns<
        {
          id: string;
          ship_requirement: string | null;
          factories: { name: string } | null;
          categories: { name: string } | null;
        }[]
      >();
    if (lError) throw new Error(lError.message);
    out.items = (lines ?? []).map((l) => ({
      id: l.id,
      factory: l.factories?.name ?? "—",
      category: l.categories?.name ?? "—",
      ship_requirement: dayToUnix(l.ship_requirement),
    }));
  }
  return out;
}

/** Aplica o PATCH de uma etapa e devolve o estado dela. */
export async function patchOrderStep(
  admin: AdminClient,
  orderId: UUID,
  step: OrderApiStep,
  input: Record<string, unknown>
): Promise<WriteResult<OrderStepRead>> {
  const who = {
    source: "gss" as const,
    userId: null,
    reason: (input.reason as string | undefined) ?? null,
    gssUser: normalizeChangedBy(input.changed_by),
  };

  if (step === "order") {
    const { order_received_date } = input as z.infer<typeof orderStepPatchSchemas.order>;
    const error = await setOrderReceivedDate(admin, orderId, order_received_date, who);
    if (error) return fail(400, error);
  } else if (step === "pi") {
    const { pi_status, pi_status_date } = input as z.infer<typeof orderStepPatchSchemas.pi>;
    const error = await recordPiStatus(admin, orderId, pi_status, pi_status_date ?? todayIso(), who);
    if (error) return fail(400, error);
  } else {
    const { items } = input as z.infer<typeof orderStepPatchSchemas.po>;
    const applied = await applyOrderItems(admin, orderId, items);
    if (!applied.ok) return fail(applied.status, applied.error);
    // Leva que muda o conjunto vira revisão; conclui o PO só se o usuário já
    // gravou o PO received date (11/11/2026).
    await recordFxcDelivery(admin, orderId, who);
  }

  revalidatePath("/orders/[id]", "page");
  revalidatePath("/orders");
  revalidatePath("/todo");
  await broadcastOrderStatusPing({ order_ids: [orderId] });

  const read = await readOrderStep(admin, orderId, step);
  if (!read) return fail(404, "Checklist step not found.");
  return { ok: true, status: 200, data: read };
}
