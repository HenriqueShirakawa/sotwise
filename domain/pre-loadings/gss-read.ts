import "server-only";

import { z } from "zod";

import { dayToUnix } from "@/lib/api-dates";
import { numericPlNumber } from "@/lib/gss/outbound/pl-shipment";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Leitura GSS → SOTWISE de PL (Pre-loading/Shipment). Mesmo padrão de
 * domain/orders/gss-read.ts: só o SOTWISE sabe esse estado (o checklist único
 * do PL, pre_loading_checklist_steps — ver docs/regras_de_negocio.md §3.9/
 * §3.10), o GSS só lê.
 *
 * `ETD`/`ETA_Brazil` são a data ESTIMADA (`estimated_date`) das etapas
 * "Shipping Date"/"ETA Brazil"; `shipping_date`/`ATA_Brazil`/`DELIVERED_DATE`
 * são a data REAL (`completed_on`) das etapas "Shipping Date"/"ATA Brazil"/
 * "Delivered". Mesmo par estimado/real que `estimated_loading_date`/
 * `loading_date` já usa para "Loading Date". Ver docs/regras_de_negocio.md §6.2.
 */

type AdminClient = ReturnType<typeof createAdminClient>;
type UUID = string;
type DateStr = string;

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export const gssPreLoadingQuerySchema = z.object({
  pl_number: z.string().trim().min(1).optional(),
  po_number: z.string().trim().min(1).optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

export type GssPreLoadingQuery = z.infer<typeof gssPreLoadingQuerySchema>;

const QUERY_KEYS = ["pl_number", "po_number", "order", "limit", "offset"] as const;

/** Só as chaves conhecidas viram query — o resto da query string é ignorado. */
export function parseGssPreLoadingQuery(params: URLSearchParams) {
  const raw: Record<string, string> = {};
  for (const key of QUERY_KEYS) {
    const value = params.get(key);
    if (value !== null && value !== "") raw[key] = value;
  }
  return gssPreLoadingQuerySchema.safeParse(raw);
}

/** As 7 datas do feed — todas em Unix (s) às 12:00 UTC (lib/api-dates.ts). */
export type PlDates = {
  estimated_loading_date: number | null;
  loading_date: number | null;
  ETD: number | null;
  ETA_Brazil: number | null;
  ATA_Brazil: number | null;
  DELIVERED_DATE: number | null;
  shipping_date: number | null;
};

/** Lote do PL: order (po_number, número quando numérico) + sufixo do lote. */
export type PlBatchRef = { order: number | string | null; batch: string };

export type GssPreLoadingRead = { pl_number: number | null } & PlDates & {
  batches: PlBatchRef[];
};

/** As 5 etapas (do checklist único do PL) que alimentam as datas do feed. */
const TRACKED_STEPS = [
  "loading_date",
  "shipping_date",
  "eta_brazil",
  "ata_brazil",
  "delivered",
] as const;
type TrackedStep = (typeof TRACKED_STEPS)[number];

type StepRow = {
  pre_loading_id: UUID;
  step: TrackedStep;
  estimated_date: DateStr | null;
  completed_on: DateStr | null;
};

/** Datas do feed a partir das etapas rastreadas de um PL. */
function datesFromSteps(steps: Partial<Record<TrackedStep, StepRow>>): PlDates {
  return {
    estimated_loading_date: dayToUnix(steps.loading_date?.estimated_date),
    loading_date: dayToUnix(steps.loading_date?.completed_on),
    ETD: dayToUnix(steps.shipping_date?.estimated_date),
    ETA_Brazil: dayToUnix(steps.eta_brazil?.estimated_date),
    ATA_Brazil: dayToUnix(steps.ata_brazil?.completed_on),
    DELIVERED_DATE: dayToUnix(steps.delivered?.completed_on),
    shipping_date: dayToUnix(steps.shipping_date?.completed_on),
  };
}

/** As datas do feed de cada PL (as 5 etapas rastreadas do checklist). */
export async function loadPlDates(admin: AdminClient, ids: UUID[]): Promise<Map<UUID, PlDates>> {
  const stepsByPl = new Map<UUID, Partial<Record<TrackedStep, StepRow>>>();
  if (ids.length > 0) {
    const { data: steps, error: stepsError } = await admin
      .from("pre_loading_checklist_steps")
      .select("pre_loading_id, step, estimated_date, completed_on")
      .in("pre_loading_id", ids)
      .in("step", TRACKED_STEPS)
      .returns<StepRow[]>();
    if (stepsError) throw new Error(stepsError.message);
    for (const row of steps ?? []) {
      const byStep = stepsByPl.get(row.pre_loading_id) ?? {};
      byStep[row.step] = row;
      stepsByPl.set(row.pre_loading_id, byStep);
    }
  }
  return new Map(ids.map((id) => [id, datesFromSteps(stepsByPl.get(id) ?? {})]));
}

/** `po_number` como número quando é numérico (o GSS usa id inteiro = po_number). */
function poRef(po: string | null | undefined): number | string | null {
  if (!po) return null;
  return /^\d+$/.test(po) ? Number(po) : po;
}

type Embed<T> = T | T[] | null;
const one = <T,>(v: Embed<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/** Lotes de cada PL, como `{ order, batch }` (ex.: { order: 1230, batch: ".02" }). */
export async function loadPlBatches(admin: AdminClient, ids: UUID[]): Promise<Map<UUID, PlBatchRef[]>> {
  const out = new Map<UUID, PlBatchRef[]>();
  if (ids.length === 0) return out;
  type LinkRow = {
    pre_loading_id: UUID;
    batches: Embed<{ batch_number: string; orders: Embed<{ po_number: string }> }>;
  };
  const { data, error } = await admin
    .from("pre_loading_batches")
    .select("pre_loading_id, batches(batch_number, orders(po_number))")
    .in("pre_loading_id", ids)
    .returns<LinkRow[]>();
  if (error) throw new Error(error.message);
  for (const link of data ?? []) {
    const batch = one(link.batches);
    if (!batch) continue;
    const list = out.get(link.pre_loading_id) ?? [];
    list.push({ order: poRef(one(batch.orders)?.po_number), batch: batch.batch_number });
    out.set(link.pre_loading_id, list);
  }
  for (const list of out.values()) {
    list.sort((x, y) => String(x.order).localeCompare(String(y.order)) || x.batch.localeCompare(y.batch));
  }
  return out;
}

/** Ids de PL que carregam pelo menos um lote da order (po_number). */
export async function plIdsForPoNumber(admin: AdminClient, poNumber: string): Promise<UUID[]> {
  type BatchRow = { id: UUID };
  const { data: batches, error: batchesError } = await admin
    .from("batches")
    .select("id, orders!inner(po_number)")
    .ilike("orders.po_number", `%${poNumber}%`)
    .is("orders.deleted_at", null)
    .returns<BatchRow[]>();
  if (batchesError) throw new Error(batchesError.message);
  const batchIds = (batches ?? []).map((b) => b.id);
  if (batchIds.length === 0) return [];

  type LinkRow = { pre_loading_id: UUID };
  const { data: links, error: linksError } = await admin
    .from("pre_loading_batches")
    .select("pre_loading_id")
    .in("batch_id", batchIds)
    .returns<LinkRow[]>();
  if (linksError) throw new Error(linksError.message);
  return [...new Set((links ?? []).map((l) => l.pre_loading_id))];
}

/**
 * Uma página de PLs no formato do GSS. `total` é a contagem do filtro (sem
 * paginação).
 */
export async function listGssPreLoadings(
  admin: AdminClient,
  query: GssPreLoadingQuery
): Promise<{ data: GssPreLoadingRead[]; total: number }> {
  let poFilterIds: UUID[] | null = null;
  if (query.po_number) {
    poFilterIds = await plIdsForPoNumber(admin, query.po_number);
    if (poFilterIds.length === 0) return { data: [], total: 0 };
  }

  let select = admin
    .from("pre_loadings")
    .select("id, pl_number, created_at", { count: "exact" })
    .is("deleted_at", null);

  if (query.pl_number) select = select.ilike("pl_number", `%${query.pl_number}%`);
  if (poFilterIds) select = select.in("id", poFilterIds);

  type PlRow = { id: UUID; pl_number: string; created_at: string };
  const { data, error, count } = await select
    // `id` desempata: PLs com o mesmo created_at não pulam/repetem entre páginas.
    .order("created_at", { ascending: query.order === "asc" })
    .order("id", { ascending: true })
    .range(query.offset, query.offset + query.limit - 1)
    .returns<PlRow[]>();
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const ids = rows.map((r) => r.id);

  const [dates, batches] = await Promise.all([loadPlDates(admin, ids), loadPlBatches(admin, ids)]);

  const out: GssPreLoadingRead[] = rows.map((row) => ({
    pl_number: numericPlNumber(row.pl_number),
    ...dates.get(row.id)!,
    batches: batches.get(row.id) ?? [],
  }));

  return { data: out, total: count ?? out.length };
}
