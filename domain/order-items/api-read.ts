import "server-only";

import { dayToUnix, timestampToUnix } from "@/lib/api-dates";
import type { createAdminClient } from "@/lib/supabase/admin";
import { findOrderRef, resolveBatchKey } from "@/domain/batches/api-read";
import type { BatchStatus, LoadingStatus } from "@/types/database";

import type { OrderItemQuery } from "./api-schema";

/**
 * Leitura das linhas FACTORY × CATEGORY pela API. Formato PLANO (decisão do
 * usuário, 06/10: nada de objetos aninhados nas views da integração) — cada
 * referência sai com o nome e o `gss_id` lado a lado.
 */

type AdminClient = ReturnType<typeof createAdminClient>;
type UUID = string;

export type OrderItemRead = {
  id: UUID;
  po_number: string | null;
  order_gss_id: string | null;
  batch_id: UUID | null;
  /** Número do lote (".02"); null = linha ainda sem lote. */
  batch: string | null;
  batch_status: BatchStatus | null;
  factory: string | null;
  factory_gss_id: string | null;
  category: string | null;
  category_gss_id: string | null;
  supplier_category_gss_id: string | null;
  /** Unix (s) às 12:00 UTC. */
  ship_requirement: number | null;
  loading_status: LoadingStatus | null;
  created_at: number | null;
  updated_at: number | null;
};

type Embed<T> = T | T[] | null;
const one = <T,>(v: Embed<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

type Row = {
  id: UUID;
  order_id: UUID;
  factory_id: UUID;
  category_id: UUID;
  batch_id: UUID | null;
  ship_requirement: string;
  loading_status: LoadingStatus | null;
  created_at: string;
  updated_at: string;
  orders: Embed<{ po_number: string; gss_id: string | null }>;
  batches: Embed<{ batch_number: string; status: BatchStatus }>;
  factories: Embed<{ name: string; gss_id: string | null }>;
  categories: Embed<{ name: string; gss_id: string | null }>;
};

const SELECT =
  "id, order_id, factory_id, category_id, batch_id, ship_requirement, loading_status, created_at, updated_at, " +
  "orders!inner(po_number, gss_id, deleted_at), batches(batch_number, status), " +
  "factories(name, gss_id), categories(name, gss_id)";

/** `gss_id` do supplier-category de cada par fábrica×categoria (factory_products). */
async function supplierCategories(admin: AdminClient, rows: Row[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const factoryIds = [...new Set(rows.map((r) => r.factory_id))];
  const categoryIds = [...new Set(rows.map((r) => r.category_id))];
  if (factoryIds.length === 0) return map;
  const { data, error } = await admin
    .from("factory_products")
    .select("factory_id, category_id, gss_id")
    .in("factory_id", factoryIds)
    .in("category_id", categoryIds)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  for (const r of data ?? []) {
    const key = `${r.factory_id}|${r.category_id}`;
    if (r.gss_id && !map.has(key)) map.set(key, r.gss_id);
  }
  return map;
}

async function shape(admin: AdminClient, rows: Row[]): Promise<OrderItemRead[]> {
  const sc = await supplierCategories(admin, rows);
  return rows.map((r) => {
    const order = one(r.orders);
    const batch = one(r.batches);
    const factory = one(r.factories);
    const category = one(r.categories);
    return {
      id: r.id,
      po_number: order?.po_number ?? null,
      order_gss_id: order?.gss_id ?? null,
      batch_id: r.batch_id,
      batch: batch?.batch_number ?? null,
      batch_status: batch?.status ?? null,
      factory: factory?.name ?? null,
      factory_gss_id: factory?.gss_id ?? null,
      category: category?.name ?? null,
      category_gss_id: category?.gss_id ?? null,
      supplier_category_gss_id: sc.get(`${r.factory_id}|${r.category_id}`) ?? null,
      ship_requirement: dayToUnix(r.ship_requirement),
      loading_status: r.loading_status,
      created_at: timestampToUnix(r.created_at),
      updated_at: timestampToUnix(r.updated_at),
    };
  });
}

export async function listOrderItems(
  admin: AdminClient,
  query: OrderItemQuery
): Promise<{ data: OrderItemRead[]; total: number }> {
  const order = await findOrderRef(admin, query);
  if (order === null) return { data: [], total: 0 };

  let batchId: UUID | null = null;
  if (query.batch_id) {
    batchId = await resolveBatchKey(admin, query.batch_id);
    if (!batchId) return { data: [], total: 0 };
  }

  const ascending = query.order === "asc";
  let q = admin
    .from("order_factory_category")
    .select(SELECT, { count: "exact" })
    .is("orders.deleted_at", null);
  if (order) q = q.eq("order_id", order.id);
  if (batchId) q = q.eq("batch_id", batchId);
  if (query.unassigned) q = q.is("batch_id", null);
  if (query.updated_since) q = q.gte("updated_at", query.updated_since);

  const { data, count, error } = await q
    .order("updated_at", { ascending })
    .order("id", { ascending })
    .range(query.offset, query.offset + query.limit - 1)
    .returns<Row[]>();
  if (error) throw new Error(error.message);
  return { data: await shape(admin, data ?? []), total: count ?? 0 };
}

/** Uma linha pelo UUID; `null` quando não existe. */
export async function getOrderItem(admin: AdminClient, id: UUID): Promise<OrderItemRead | null> {
  const { data, error } = await admin
    .from("order_factory_category")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle()
    .returns<Row | null>();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const [item] = await shape(admin, [data]);
  return item;
}
