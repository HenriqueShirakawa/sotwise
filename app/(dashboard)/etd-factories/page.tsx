import { verifySession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BatchStatus } from "@/types/database";

import { EtdFactoriesClient, type EtdFactoryRow } from "./etd-factories-client";

const PAGE = 1000; // limite de linhas por request do PostgREST

/** Busca TODAS as linhas de uma query paginando em blocos de 1000. */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await build(from, from + PAGE - 1);
    const chunk = data ?? [];
    all.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return all;
}

// Filtro padrão da rua ETD Factories: só lotes em produção ou pre-loading
// (ver docs/regras_de_negocio.md §3.7.4, mesmo com o enum tendo 6 valores).
const ACTIVE_BATCH_STATUSES: BatchStatus[] = ["in_production", "preloading"];

function daysBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

type OrderRow = { id: string; po_number: string; client_id: string | null; date_po: string | null };
type BatchRow = { id: string; batch_number: string; status: BatchStatus };
type OfcRow = {
  id: string;
  order_id: string;
  category_id: string;
  factory_id: string;
  batch_id: string | null;
  ship_requirement: string | null;
};
type EtdRow = {
  order_factory_category_id: string;
  initial_date: string | null;
  current_date: string | null;
  ready: boolean;
  ready_date: string | null;
  updated_at: string;
};

/** Monta as linhas exibidas — separado do componente pra manter o `Date.now()`
 * (impuro) fora do corpo de uma função que o React Compiler trata como componente. */
function buildRows(
  ofcRows: OfcRow[],
  orderById: Map<string, OrderRow>,
  batchById: Map<string, BatchRow>,
  etdByOfcId: Map<string, EtdRow>,
  factoryNameById: Map<string, string>,
  categoryNameById: Map<string, string>,
  clientNameById: Map<string, string>
): EtdFactoryRow[] {
  const todayMs = Date.now();
  const rows: EtdFactoryRow[] = [];
  for (const ofc of ofcRows) {
    const batch = ofc.batch_id ? batchById.get(ofc.batch_id) : undefined;
    if (!batch || !ACTIVE_BATCH_STATUSES.includes(batch.status)) continue;
    const order = orderById.get(ofc.order_id);
    if (!order) continue;
    const etd = etdByOfcId.get(ofc.id);

    rows.push({
      id: ofc.id,
      client: order.client_id ? (clientNameById.get(order.client_id) ?? null) : null,
      client_id: order.client_id,
      po_number: order.po_number,
      batch_number: batch.batch_number,
      factory: factoryNameById.get(ofc.factory_id) ?? "—",
      factory_id: ofc.factory_id,
      category: categoryNameById.get(ofc.category_id) ?? "—",
      category_id: ofc.category_id,
      order_date: order.date_po,
      shipment_req: ofc.ship_requirement,
      initial_date: etd?.initial_date ?? null,
      current_date: etd?.current_date ?? null,
      days_delay: daysBetween(etd?.initial_date ?? null, etd?.current_date ?? null),
      last_updated: etd?.updated_at ?? null,
      batch_status: batch.status,
      ready_parts: etd?.ready ?? false,
      gap_of_ready:
        etd?.ready && etd.ready_date
          ? Math.round((todayMs - Date.parse(etd.ready_date)) / 86_400_000)
          : null,
    });
  }
  return rows;
}

export default async function EtdFactoriesPage() {
  await verifySession();
  const admin = createAdminClient();

  const [orders, batches, ofcRows, etdRows, factoryRes, categoryRes, clientRes] =
    await Promise.all([
      fetchAll<{
        id: string;
        po_number: string;
        client_id: string | null;
        date_po: string | null;
      }>((from, to) =>
        admin
          .from("orders")
          .select("id, po_number, client_id, date_po")
          .is("deleted_at", null)
          .range(from, to)
      ),
      fetchAll<{ id: string; batch_number: string; status: BatchStatus }>((from, to) =>
        admin.from("batches").select("id, batch_number, status").range(from, to)
      ),
      fetchAll<{
        id: string;
        order_id: string;
        category_id: string;
        factory_id: string;
        batch_id: string | null;
        ship_requirement: string | null;
      }>((from, to) =>
        admin
          .from("order_factory_category")
          .select("id, order_id, category_id, factory_id, batch_id, ship_requirement")
          .range(from, to)
      ),
      fetchAll<{
        order_factory_category_id: string;
        initial_date: string | null;
        current_date: string | null;
        ready: boolean;
        ready_date: string | null;
        updated_at: string;
      }>((from, to) =>
        admin
          .from("etd_info")
          .select(
            "order_factory_category_id, initial_date, current_date, ready, ready_date, updated_at"
          )
          .range(from, to)
      ),
      admin.from("factories").select("id, name").is("deleted_at", null),
      admin.from("categories").select("id, name").is("deleted_at", null),
      admin.from("clients").select("id, name").is("deleted_at", null),
    ]);

  const orderById = new Map(orders.map((o) => [o.id, o]));
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const factoryNameById = new Map((factoryRes.data ?? []).map((f) => [f.id, f.name]));
  const categoryNameById = new Map((categoryRes.data ?? []).map((c) => [c.id, c.name]));
  const clientNameById = new Map((clientRes.data ?? []).map((c) => [c.id, c.name]));
  const etdByOfcId = new Map(etdRows.map((e) => [e.order_factory_category_id, e]));

  const rows = buildRows(
    ofcRows,
    orderById,
    batchById,
    etdByOfcId,
    factoryNameById,
    categoryNameById,
    clientNameById
  );

  // Ordenação padrão: Client, depois PO — igual ao Bubble.
  rows.sort(
    (a, b) =>
      (a.client ?? "").localeCompare(b.client ?? "") ||
      (Number(a.po_number) || 0) - (Number(b.po_number) || 0) ||
      a.batch_number.localeCompare(b.batch_number, undefined, { numeric: true })
  );

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const clients = (clientRes.data ?? [])
    .map((c) => ({ id: c.id, name: c.name }))
    .sort(byName);
  const factories = (factoryRes.data ?? [])
    .map((f) => ({ id: f.id, name: f.name }))
    .sort(byName);
  const categories = (categoryRes.data ?? [])
    .map((c) => ({ id: c.id, name: c.name }))
    .sort(byName);

  return (
    <EtdFactoriesClient rows={rows} clients={clients} factories={factories} categories={categories} />
  );
}
