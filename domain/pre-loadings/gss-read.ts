import "server-only";

import { z } from "zod";

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

export type GssPreLoadingRead = {
  pl_number: number | null;
  estimated_loading_date: DateStr | null;
  loading_date: DateStr | null;
  ETD: DateStr | null;
  ETA_Brazil: DateStr | null;
  ATA_Brazil: DateStr | null;
  DELIVERED_DATE: DateStr | null;
  shipping_date: DateStr | null;
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

/** Extrai o número de "PL - 1354" → 1354. null se o formato não bater. */
function numericPlNumber(plNumber: string): number | null {
  const match = plNumber.match(/(\d+)\s*$/);
  return match ? Number(match[1]) : null;
}

/** Ids de PL que carregam pelo menos um lote da order (po_number). */
async function plIdsForPoNumber(admin: AdminClient, poNumber: string): Promise<UUID[]> {
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

  const out: GssPreLoadingRead[] = rows.map((row) => {
    const steps = stepsByPl.get(row.id) ?? {};
    return {
      pl_number: numericPlNumber(row.pl_number),
      estimated_loading_date: steps.loading_date?.estimated_date ?? null,
      loading_date: steps.loading_date?.completed_on ?? null,
      ETD: steps.shipping_date?.estimated_date ?? null,
      ETA_Brazil: steps.eta_brazil?.estimated_date ?? null,
      ATA_Brazil: steps.ata_brazil?.completed_on ?? null,
      DELIVERED_DATE: steps.delivered?.completed_on ?? null,
      shipping_date: steps.shipping_date?.completed_on ?? null,
    };
  });

  return { data: out, total: count ?? out.length };
}
