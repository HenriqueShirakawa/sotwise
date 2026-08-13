import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { readColumnVisibility } from "@/lib/column-prefs";
import { fetchAll } from "@/lib/fetch-all";
import { daysDelay, gapOfReady } from "@/lib/etd";
import type { BatchStatus } from "@/types/database";

import { EtdFactoriesClient, type EtdFactoryRow } from "./etd-factories-client";

// Filtro padrão da tela ETD Factories: só lotes em produção ou pre-loading
// (ver docs/regras_de_negocio.md §3.7.4, mesmo com o enum tendo 6 valores).
const ACTIVE_BATCH_STATUSES: BatchStatus[] = ["in_production", "preloading"];

type EtdEmbed = {
  initial_date: string | null;
  current_date: string | null;
  ready: boolean;
  ready_date: string | null;
  updated_at: string;
};

/**
 * Uma entrada Factory×Category de um lote ATIVO, já com o lote, o pedido e o
 * ETD embutidos (inner join no PostgREST). Trazer só os lotes ativos aqui, em
 * vez de baixar order_factory_category/batches/etd_info inteiros e filtrar no
 * app, corta ~88% do volume (9.485 → ~1.069 linhas).
 */
type OfcActiveRow = {
  id: string;
  order_id: string;
  category_id: string;
  factory_id: string;
  ship_requirement: string | null;
  batches: { batch_number: string; status: BatchStatus } | null;
  orders: { po_number: string; client_id: string | null; date_po: string | null } | null;
  etd_info: EtdEmbed | EtdEmbed[] | null;
};

/** Monta as linhas exibidas — separado do componente pra manter o `Date.now()`
 * (impuro) fora do corpo de uma função que o React Compiler trata como componente. */
function buildRows(
  ofcRows: OfcActiveRow[],
  factoryNameById: Map<string, string>,
  categoryNameById: Map<string, string>,
  clientNameById: Map<string, string>
): EtdFactoryRow[] {
  const todayMs = Date.now();
  const rows: EtdFactoryRow[] = [];
  for (const ofc of ofcRows) {
    const batch = ofc.batches;
    const order = ofc.orders;
    // Os inner joins garantem lote ativo + pedido não-deletado; guarda defensiva.
    if (!batch || !order) continue;
    const etd = Array.isArray(ofc.etd_info) ? ofc.etd_info[0] : ofc.etd_info;

    rows.push({
      id: ofc.id,
      order_id: ofc.order_id,
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
      days_delay: daysDelay(etd?.initial_date ?? null, etd?.current_date ?? null),
      last_updated: etd?.updated_at ?? null,
      batch_status: batch.status,
      ready_parts: etd?.ready ?? false,
      gap_of_ready: gapOfReady(etd?.ready, etd?.ready_date, todayMs),
    });
  }
  return rows;
}

export default async function EtdFactoriesPage() {
  const { profile } = await requireFeature("etd_factories");
  const admin = createAdminClient();

  // Uma query com inner join nos lotes ativos + pedido não-deletado, embutindo
  // batch/order/etd. As listas de factory/category/client vêm à parte porque os
  // filtros precisam de TODAS as opções (não só as dos lotes ativos).
  const [ofcRows, factoryRes, categoryRes, clientRes] = await Promise.all([
    fetchAll<OfcActiveRow>((from, to) =>
      admin
        .from("order_factory_category")
        .select(
          "id, order_id, category_id, factory_id, ship_requirement, " +
            "batches!inner(batch_number, status), " +
            "orders!inner(po_number, client_id, date_po), " +
            "etd_info(initial_date, current_date, ready, ready_date, updated_at)"
        )
        .in("batches.status", ACTIVE_BATCH_STATUSES)
        .is("orders.deleted_at", null)
        .range(from, to)
        .returns<OfcActiveRow[]>()
    ),
    // Cadastros dos filtros: paginados para nenhum ficar cortado no teto de
    // 1000 do PostgREST (ver lib/fetch-all).
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("factories").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("categories").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("clients").select("id, name").is("deleted_at", null).range(from, to)
    ),
  ]);

  const factoryNameById = new Map(factoryRes.map((f) => [f.id, f.name]));
  const categoryNameById = new Map(categoryRes.map((c) => [c.id, c.name]));
  const clientNameById = new Map(clientRes.map((c) => [c.id, c.name]));

  const rows = buildRows(ofcRows, factoryNameById, categoryNameById, clientNameById);

  // Ordenação padrão: Client, depois PO — igual ao Bubble.
  rows.sort(
    (a, b) =>
      (a.client ?? "").localeCompare(b.client ?? "") ||
      (Number(a.po_number) || 0) - (Number(b.po_number) || 0) ||
      a.batch_number.localeCompare(b.batch_number, undefined, { numeric: true })
  );

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const clients = clientRes
    .map((c) => ({ id: c.id, name: c.name }))
    .sort(byName);
  const factories = factoryRes
    .map((f) => ({ id: f.id, name: f.name }))
    .sort(byName);
  const categories = categoryRes
    .map((c) => ({ id: c.id, name: c.name }))
    .sort(byName);

  return (
    <EtdFactoriesClient
      rows={rows}
      clients={clients}
      factories={factories}
      categories={categories}
      initialColumns={readColumnVisibility(profile.ui_preferences, "etd-factories")}
    />
  );
}
