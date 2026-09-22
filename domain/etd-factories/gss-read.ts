import "server-only";

import { z } from "zod";

import type { createAdminClient } from "@/lib/supabase/admin";
import type { BatchStatus } from "@/types/database";

/**
 * Leitura GSS → SOTWISE das entradas Factory×Category com ETD — a mesma
 * informação da rua "ETD Factories" e do tool de copilot `list_etd_entries`
 * (domain/copilot/tools.ts), servida como feed de sincronização em vez de
 * tela. Os dados nascem na etapa ETD do checklist da Order (etd_info) — só o
 * SOTWISE os tem. Ver docs/regras_de_negocio.md §3.7.4/§6.2.
 *
 * Diferente da tela (que só mostra lotes `in_production`/`preloading` por
 * padrão), aqui sem filtro devolve TODOS os status de lote — é um feed de
 * sync, não uma tela; `batch_status` é o jeito de restringir.
 *
 * `lote` sozinho (formato ".NN") não é único no sistema — o número reseta a
 * cada Order — por isso toda linha sai também com `po_number`, pra o GSS
 * religar a entrada à Order certa.
 */

type AdminClient = ReturnType<typeof createAdminClient>;
type UUID = string;
type DateStr = string;

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

const BATCH_STATUSES = [
  "in_negotiation",
  "in_production",
  "preloading",
  "in_transit",
  "delivered",
  "canceled",
] as const satisfies readonly BatchStatus[];

export const gssEtdQuerySchema = z.object({
  po_number: z.string().trim().min(1).optional(),
  batch_status: z
    .string()
    .trim()
    .optional()
    .transform((raw) =>
      raw
        ? raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : []
    )
    .pipe(z.array(z.enum(BATCH_STATUSES))),
  order: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

export type GssEtdQuery = z.infer<typeof gssEtdQuerySchema>;

const QUERY_KEYS = ["po_number", "batch_status", "order", "limit", "offset"] as const;

/** Só as chaves conhecidas viram query — o resto da query string é ignorado. */
export function parseGssEtdQuery(params: URLSearchParams) {
  const raw: Record<string, string> = {};
  for (const key of QUERY_KEYS) {
    const value = params.get(key);
    if (value !== null && value !== "") raw[key] = value;
  }
  return gssEtdQuerySchema.safeParse(raw);
}

export type GssEtdRead = {
  po_number: string | null;
  lote: string;
  FACTORY: string | null;
  category: string | null;
  initial_date: DateStr | null;
  current_date: DateStr | null;
  ready_parts: boolean;
};

type Embed<T> = T | T[] | null;
const one = <T,>(v: Embed<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

type OfcRow = {
  factory_id: UUID;
  category_id: UUID;
  batches: Embed<{ batch_number: string }>;
  orders: Embed<{ po_number: string }>;
  etd_info: Embed<{ initial_date: DateStr | null; current_date: DateStr | null; ready: boolean }>;
};

/** Busca `{id → name}` só dos ids realmente usados na página. */
async function nameMap(
  admin: AdminClient,
  table: "factories" | "categories",
  ids: UUID[]
): Promise<Map<UUID, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data, error } = await admin
    .from(table)
    .select("id, name")
    .in("id", unique)
    .returns<{ id: UUID; name: string }[]>();
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row) => [row.id, row.name]));
}

/**
 * Uma página de entradas Factory×Category com ETD, no formato do GSS. `total`
 * é a contagem do filtro (sem paginação).
 */
export async function listGssEtdEntries(
  admin: AdminClient,
  query: GssEtdQuery
): Promise<{ data: GssEtdRead[]; total: number }> {
  let select = admin
    .from("order_factory_category")
    .select(
      "factory_id, category_id, created_at, batches!inner(batch_number, status), " +
        "orders!inner(po_number), etd_info(initial_date, current_date, ready)",
      { count: "exact" }
    )
    .is("orders.deleted_at", null);

  if (query.po_number) select = select.ilike("orders.po_number", `%${query.po_number}%`);
  if (query.batch_status.length > 0) select = select.in("batches.status", query.batch_status);

  const { data, error, count } = await select
    // `id`-like tiebreak não existe aqui (linha não tem id no select) — usa
    // created_at, único o bastante pro universo de Factory×Category.
    .order("created_at", { ascending: query.order === "asc" })
    .range(query.offset, query.offset + query.limit - 1)
    .returns<OfcRow[]>();
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const [factories, categories] = await Promise.all([
    nameMap(admin, "factories", rows.map((r) => r.factory_id)),
    nameMap(admin, "categories", rows.map((r) => r.category_id)),
  ]);

  const out: GssEtdRead[] = rows.map((row) => {
    const batch = one(row.batches);
    const order = one(row.orders);
    const etd = one(row.etd_info);
    return {
      po_number: order?.po_number ?? null,
      lote: batch?.batch_number ?? "",
      FACTORY: factories.get(row.factory_id) ?? null,
      category: categories.get(row.category_id) ?? null,
      initial_date: etd?.initial_date ?? null,
      current_date: etd?.current_date ?? null,
      ready_parts: etd?.ready ?? false,
    };
  });

  return { data: out, total: count ?? out.length };
}
