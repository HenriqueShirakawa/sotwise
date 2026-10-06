import "server-only";

import { timestampToUnix } from "@/lib/api-dates";
import { fetchAll } from "@/lib/fetch-all";
import { numericPlNumber } from "@/lib/gss/outbound/pl-shipment";
import type { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/domain/api/write-result";
import {
  loadPlBatches,
  loadPlDates,
  plIdsForPoNumber,
  type PlBatchRef,
  type PlDates,
} from "@/domain/pre-loadings/gss-read";

import type { ShipmentQuery } from "./api-schema";

/**
 * Leitura de PL + SHIPMENT (`GET /api/shipments`, `GET /api/shipments/{id}`).
 * Mesma view PLANA do GET /api/pre-loadings (decisão do usuário, 06/10) + o
 * mínimo para o REST: `id`, `gss_id`, `status` e os lotes.
 *
 * `status`: `preloading` enquanto não há embarque; depois, o do Shipment
 * (`in_transit` → `delivered` pela etapa Delivered).
 *
 * `updated_since` olha o PL, o embarque E as etapas do checklist (onde moram
 * as datas) — mudar uma data faz o PL reaparecer na varredura incremental.
 */

type AdminClient = ReturnType<typeof createAdminClient>;
type UUID = string;

export type ShipmentRead = {
  id: UUID;
  gss_id: string | null;
  pl_number: number | null;
  status: string;
  batches: PlBatchRef[];
} & PlDates & {
    created_at: number | null;
    updated_at: number | null;
  };

type Embed<T> = T | T[] | null;
const one = <T,>(v: Embed<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

type PlRow = {
  id: UUID;
  gss_id: string | null;
  pl_number: string;
  created_at: string;
  updated_at: string;
  shipments: Embed<{ id: UUID; status: string; updated_at: string; deleted_at: string | null }>;
};

const SELECT_LEFT = "id, gss_id, pl_number, created_at, updated_at, shipments(id, status, updated_at, deleted_at)";
const SELECT_INNER =
  "id, gss_id, pl_number, created_at, updated_at, shipments!inner(id, status, updated_at, deleted_at)";

/** `{id}` das rotas: UUID do PL ou o `pl_number` (ex.: /api/shipments/1306). */
export async function resolveShipmentKey(admin: AdminClient, key: string): Promise<UUID | null> {
  const column = isUuid(key) ? "id" : "pl_number";
  const { data, error } = await admin
    .from("pre_loadings")
    .select("id")
    .eq(column, key.trim())
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

/** Embarque vivo do PL (o 1:1 do Confirm Shipping), ou null. */
function liveShipment(row: PlRow) {
  const s = one(row.shipments);
  return s && !s.deleted_at ? s : null;
}

async function shape(admin: AdminClient, rows: PlRow[]): Promise<ShipmentRead[]> {
  const ids = rows.map((r) => r.id);
  const [dates, batches] = await Promise.all([loadPlDates(admin, ids), loadPlBatches(admin, ids)]);
  return rows.map((r) => {
    const shipment = liveShipment(r);
    const updated = [r.updated_at, shipment?.updated_at].filter(Boolean).sort().pop() ?? r.updated_at;
    return {
      id: r.id,
      gss_id: r.gss_id,
      pl_number: numericPlNumber(r.pl_number),
      status: shipment?.status ?? "preloading",
      batches: batches.get(r.id) ?? [],
      ...dates.get(r.id)!,
      created_at: timestampToUnix(r.created_at),
      updated_at: timestampToUnix(updated),
    };
  });
}

/** Ids de PL com etapa ou embarque alterado desde `since` (o PL em si é filtrado direto). */
async function plIdsTouchedSince(admin: AdminClient, since: string): Promise<UUID[]> {
  const [steps, shipments] = await Promise.all([
    fetchAll<{ pre_loading_id: UUID }>((from, to) =>
      admin
        .from("pre_loading_checklist_steps")
        .select("pre_loading_id")
        .gte("updated_at", since)
        .range(from, to)
    ),
    fetchAll<{ pre_loading_id: UUID }>((from, to) =>
      admin.from("shipments").select("pre_loading_id").gte("updated_at", since).range(from, to)
    ),
  ]);
  return [...new Set([...steps, ...shipments].map((r) => r.pre_loading_id))];
}

/** Lista de UUIDs no `or()` do PostgREST — vai na URL, então tem teto. */
const MAX_TOUCHED = 300;

export async function listShipments(
  admin: AdminClient,
  query: ShipmentQuery
): Promise<{ data: ShipmentRead[]; total: number }> {
  let poFilterIds: UUID[] | null = null;
  if (query.po_number) {
    poFilterIds = await plIdsForPoNumber(admin, query.po_number);
    if (poFilterIds.length === 0) return { data: [], total: 0 };
  }

  const shipped = query.status === "in_transit" || query.status === "delivered";
  let q = admin
    .from("pre_loadings")
    .select(shipped ? SELECT_INNER : SELECT_LEFT, { count: "exact" })
    .is("deleted_at", null);

  if (query.pl_number) q = q.eq("pl_number", query.pl_number);
  if (poFilterIds) q = q.in("id", poFilterIds);
  if (shipped) q = q.eq("shipments.status", query.status!).is("shipments.deleted_at", null);
  if (query.status === "preloading") q = q.is("shipments", null);

  if (query.updated_since) {
    const touched = await plIdsTouchedSince(admin, query.updated_since);
    if (touched.length > MAX_TOUCHED) {
      throw new RangeError(
        `Too many changes since updated_since (${touched.length} pre-loadings). Use a more recent updated_since.`
      );
    }
    q = touched.length
      ? q.or(`updated_at.gte."${query.updated_since}",id.in.(${touched.join(",")})`)
      : q.gte("updated_at", query.updated_since);
  }

  const { data, error, count } = await q
    .order("created_at", { ascending: query.order === "asc" })
    .order("id", { ascending: true })
    .range(query.offset, query.offset + query.limit - 1)
    .returns<PlRow[]>();
  if (error) throw new Error(error.message);
  return { data: await shape(admin, data ?? []), total: count ?? 0 };
}

export async function getShipment(admin: AdminClient, id: UUID): Promise<ShipmentRead | null> {
  const { data, error } = await admin
    .from("pre_loadings")
    .select(SELECT_LEFT)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle()
    .returns<PlRow | null>();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const [row] = await shape(admin, [data]);
  return row;
}
