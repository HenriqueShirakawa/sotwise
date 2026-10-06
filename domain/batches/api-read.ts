import "server-only";

import { dayToUnix, timestampToUnix } from "@/lib/api-dates";
import { fetchAll } from "@/lib/fetch-all";
import type { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/domain/api/write-result";
import type { BatchStatus, LoadingStatus } from "@/types/database";

import type { BatchQuery } from "./api-schema";

/**
 * Leitura de LOTES pela API (`GET /api/batches`, `GET /api/batches/{id}`).
 *
 * Cada lote sai com a order dona (na chave que o GSS conhece: `gss_id` e
 * `po_number`), as linhas Factory×Category que estão nele e os PLs em que
 * entrou. As bibliotecas saem `{ id, gss_id, name }` e cada linha traz também
 * o `supplier_category_gss_id` — a mesma chave do `items[]` do POST de orders,
 * para o GSS reconciliar sem conhecer UUID interno.
 *
 * ⚠️ `updated_at` é o do lote: mover/criar uma linha não toca o lote, então
 * `updated_since` pega mudança de número/status, não de conteúdo.
 */

type AdminClient = ReturnType<typeof createAdminClient>;
type UUID = string;

type LibraryRef = { id: UUID; gss_id: string | null; name: string };

export type BatchReadItem = {
  id: UUID;
  supplier_category_gss_id: string | null;
  factory: LibraryRef | null;
  category: LibraryRef | null;
  /** Unix (s) às 12:00 UTC — lib/api-dates.ts. */
  ship_requirement: number | null;
  loading_status: LoadingStatus | null;
};

export type BatchRead = {
  id: UUID;
  /** id do OrderBatch no GSS (o lote nasce lá); null nos lotes só do SOTWISE. */
  gss_id: string | null;
  batch_number: string;
  /** `po_number` + `batch_number` quando o número é o sufixo ".NN" (ex.: "1439.04"). */
  full_number: string;
  status: BatchStatus;
  split_from_batch_id: UUID | null;
  order: { id: UUID; gss_id: string | null; po_number: string };
  items: BatchReadItem[];
  pre_loadings: { id: UUID; pl_number: string }[];
  /** Unix (s), com fração. */
  created_at: number | null;
  updated_at: number | null;
};

type BatchRow = {
  id: UUID;
  gss_id: string | null;
  order_id: UUID;
  batch_number: string;
  status: BatchStatus;
  split_from_batch_id: UUID | null;
  created_at: string;
  updated_at: string;
};

const BATCH_COLUMNS = "id, gss_id, order_id, batch_number, status, split_from_batch_id, created_at, updated_at";

/** O `.in()` vai na URL — pedaços pequenos evitam URL gigante com muitos lotes. */
const IN_CHUNK = 150;

function chunks<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += IN_CHUNK) out.push(list.slice(i, i + IN_CHUNK));
  return out;
}

async function libraryMap(
  admin: AdminClient,
  table: "factories" | "categories",
  ids: UUID[]
): Promise<Map<UUID, LibraryRef>> {
  const map = new Map<UUID, LibraryRef>();
  for (const part of chunks(ids)) {
    const { data, error } = await admin
      .from(table)
      .select("id, name, gss_id")
      .in("id", part)
      .returns<LibraryRef[]>();
    if (error) throw new Error(error.message);
    for (const row of data ?? []) map.set(row.id, row);
  }
  return map;
}

/** `gss_id` do supplier-category de cada par fábrica×categoria (factory_products). */
async function supplierCategoryMap(
  admin: AdminClient,
  factoryIds: UUID[],
  categoryIds: UUID[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (factoryIds.length === 0 || categoryIds.length === 0) return map;
  for (const part of chunks(factoryIds)) {
    const rows = await fetchAll<{ factory_id: UUID; category_id: UUID; gss_id: string | null }>(
      (from, to) =>
        admin
          .from("factory_products")
          .select("factory_id, category_id, gss_id")
          .in("factory_id", part)
          .in("category_id", categoryIds)
          .is("deleted_at", null)
          .range(from, to)
    );
    for (const row of rows) {
      const key = `${row.factory_id}|${row.category_id}`;
      if (row.gss_id && !map.has(key)) map.set(key, row.gss_id);
    }
  }
  return map;
}

/** Junta order, linhas e PLs aos lotes, preservando a ordem de `rows`. */
async function hydrate(admin: AdminClient, rows: BatchRow[]): Promise<BatchRead[]> {
  if (rows.length === 0) return [];
  const batchIds = rows.map((r) => r.id);
  const orderIds = [...new Set(rows.map((r) => r.order_id))];

  type OrderRow = { id: UUID; gss_id: string | null; po_number: string };
  type OfcRow = {
    id: UUID;
    batch_id: UUID | null;
    factory_id: UUID;
    category_id: UUID;
    ship_requirement: string;
    loading_status: LoadingStatus | null;
  };
  type PlLinkRow = { batch_id: UUID; pre_loadings: { id: UUID; pl_number: string } | null };

  const orders = new Map<UUID, OrderRow>();
  for (const part of chunks(orderIds)) {
    const { data, error } = await admin
      .from("orders")
      .select("id, gss_id, po_number")
      .in("id", part)
      .returns<OrderRow[]>();
    if (error) throw new Error(error.message);
    for (const o of data ?? []) orders.set(o.id, o);
  }

  const lines: OfcRow[] = [];
  const plLinks: PlLinkRow[] = [];
  for (const part of chunks(batchIds)) {
    lines.push(
      ...(await fetchAll<OfcRow>((from, to) =>
        admin
          .from("order_factory_category")
          .select("id, batch_id, factory_id, category_id, ship_requirement, loading_status")
          .in("batch_id", part)
          .order("id")
          .range(from, to)
      ))
    );
    plLinks.push(
      ...(await fetchAll<PlLinkRow>((from, to) =>
        admin
          .from("pre_loading_batches")
          .select("batch_id, pre_loadings(id, pl_number)")
          .in("batch_id", part)
          .range(from, to)
          .returns<PlLinkRow[]>()
      ))
    );
  }

  const factoryIds = [...new Set(lines.map((l) => l.factory_id))];
  const categoryIds = [...new Set(lines.map((l) => l.category_id))];
  const [factories, categories, supplierCategories] = await Promise.all([
    libraryMap(admin, "factories", factoryIds),
    libraryMap(admin, "categories", categoryIds),
    supplierCategoryMap(admin, factoryIds, categoryIds),
  ]);

  const itemsByBatch = new Map<UUID, BatchReadItem[]>();
  for (const l of lines) {
    if (!l.batch_id) continue;
    const list = itemsByBatch.get(l.batch_id) ?? [];
    list.push({
      id: l.id,
      supplier_category_gss_id: supplierCategories.get(`${l.factory_id}|${l.category_id}`) ?? null,
      factory: factories.get(l.factory_id) ?? null,
      category: categories.get(l.category_id) ?? null,
      ship_requirement: dayToUnix(l.ship_requirement),
      loading_status: l.loading_status,
    });
    itemsByBatch.set(l.batch_id, list);
  }

  const plsByBatch = new Map<UUID, { id: UUID; pl_number: string }[]>();
  for (const link of plLinks) {
    if (!link.pre_loadings) continue;
    const list = plsByBatch.get(link.batch_id) ?? [];
    list.push(link.pre_loadings);
    plsByBatch.set(link.batch_id, list);
  }

  return rows.map((r) => {
    const order = orders.get(r.order_id) ?? { id: r.order_id, gss_id: null, po_number: "" };
    return {
      id: r.id,
      gss_id: r.gss_id,
      batch_number: r.batch_number,
      full_number: r.batch_number.startsWith(".")
        ? `${order.po_number}${r.batch_number}`
        : r.batch_number,
      status: r.status,
      split_from_batch_id: r.split_from_batch_id,
      order,
      items: itemsByBatch.get(r.id) ?? [],
      pre_loadings: plsByBatch.get(r.id) ?? [],
      created_at: timestampToUnix(r.created_at),
      updated_at: timestampToUnix(r.updated_at),
    };
  });
}

/**
 * Order apontada por `order_gss_id`/`po_number`. `undefined` = sem filtro de
 * order; `null` = filtro informado mas a order não existe.
 *
 * `order_gss_id` casa primeiro por `orders.gss_id`. Sem match, cai no
 * `po_number` igual ao id do GSS (a regra do de-para: GSS.id = po_number, ver
 * scripts/sync-gss/orders-link-po.ts) — só se essa order ainda não estiver
 * ligada a OUTRO id do GSS. Cobre orders novas que ainda não ganharam gss_id
 * (ex.: 1667, cujos lotes o GSS criou antes do vínculo).
 */
export async function findOrderRef(
  admin: AdminClient,
  ref: { order_gss_id?: string; po_number?: string }
): Promise<{ id: UUID; po_number: string } | null | undefined> {
  if (!ref.order_gss_id && !ref.po_number) return undefined;

  if (ref.order_gss_id) {
    const { data, error } = await admin
      .from("orders")
      .select("id, po_number")
      .eq("gss_id", ref.order_gss_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data;

    const { data: byPo, error: poError } = await admin
      .from("orders")
      .select("id, po_number")
      .eq("po_number", ref.order_gss_id)
      .is("gss_id", null)
      .maybeSingle();
    if (poError) throw new Error(poError.message);
    return byPo ?? null;
  }

  const { data, error } = await admin
    .from("orders")
    .select("id, po_number")
    .eq("po_number", ref.po_number!)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function listBatches(
  admin: AdminClient,
  query: BatchQuery
): Promise<{ data: BatchRead[]; total: number }> {
  const order = await findOrderRef(admin, query);
  if (order === null) return { data: [], total: 0 };

  const ascending = query.order === "asc";
  let q = admin.from("batches").select(BATCH_COLUMNS, { count: "exact" });
  if (order) q = q.eq("order_id", order.id);
  if (query.gss_id) q = q.eq("gss_id", query.gss_id);
  if (query.status) q = q.eq("status", query.status);
  if (query.updated_since) q = q.gte("updated_at", query.updated_since);

  const { data, count, error } = await q
    .order("updated_at", { ascending })
    .order("id", { ascending })
    .range(query.offset, query.offset + query.limit - 1)
    .returns<BatchRow[]>();
  if (error) throw new Error(error.message);

  return { data: await hydrate(admin, data ?? []), total: count ?? 0 };
}

/**
 * `{id}` das rotas de lote: UUID ou o `full_number` (ex.: "1230.02" = order
 * 1230, lote ".02" — o mesmo `batch_code` do GSS). `null` quando não casa.
 */
export async function resolveBatchKey(admin: AdminClient, key: string): Promise<UUID | null> {
  if (isUuid(key)) return key;
  const m = /^(.+)(\.\d+)$/.exec(key.trim());
  if (!m) return null;
  const [, poNumber, batchNumber] = m;
  const { data, error } = await admin
    .from("batches")
    .select("id, orders!inner(po_number)")
    .eq("batch_number", batchNumber)
    .eq("orders.po_number", poNumber)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

/** Um lote pelo UUID; `null` quando não existe. */
export async function getBatch(admin: AdminClient, id: UUID): Promise<BatchRead | null> {
  const { data, error } = await admin
    .from("batches")
    .select(BATCH_COLUMNS)
    .eq("id", id)
    .maybeSingle()
    .returns<BatchRow | null>();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const [batch] = await hydrate(admin, [data]);
  return batch;
}
