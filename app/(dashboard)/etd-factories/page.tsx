import { redirect } from "next/navigation";

import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { readColumnVisibility } from "@/lib/column-prefs";
import { readListState } from "@/lib/list-state";
import { fetchAll } from "@/lib/fetch-all";
import { daysDelay, gapOfReady } from "@/lib/etd";
import type { Database } from "@/types/database";

import { EtdFactoriesClient, type EtdFactoryRow } from "./etd-factories-client";
import { PAGE_SIZE, SORT_COLUMNS, listStateToSearch, parseListState } from "./list-params";

type EtdListRow = Database["public"]["Views"]["etd_list"]["Row"];

/** Filtros de range de data → coluna da view `etd_list`. */
const DATE_RANGES = [
  ["shipment_req", "shipment_from", "shipment_to"],
  ["initial_date", "initial_from", "initial_to"],
  ["current_date", "current_from", "current_to"],
  ["last_updated_day", "updated_from", "updated_to"],
] as const;

/** Monta as linhas exibidas — separado do componente pra manter o `Date.now()`
 * (impuro) fora do corpo de uma função que o React Compiler trata como componente. */
function buildRows(list: EtdListRow[]): EtdFactoryRow[] {
  const todayMs = Date.now();
  return list.map((r) => ({
    id: r.id,
    order_id: r.order_id,
    client: r.client,
    client_id: r.client_id,
    po_number: r.po_number,
    batch_number: r.batch_number,
    factory: r.factory,
    factory_id: r.factory_id,
    category: r.category,
    category_id: r.category_id,
    order_date: r.order_date,
    shipment_req: r.shipment_req,
    initial_date: r.initial_date,
    current_date: r.current_date,
    days_delay: daysDelay(r.initial_date, r.current_date),
    last_updated: r.last_updated,
    batch_status: r.batch_status,
    ready_parts: r.ready_parts,
    gap_of_ready: gapOfReady(r.ready_parts, r.ready_date, todayMs),
    inspection: r.inspection,
    dispatch_location: r.dispatch_location,
    dispatch_date: r.dispatch_date,
  }));
}

export const metadata = { title: "ETD factories" };

/**
 * ETD Factories — paginada no SERVIDOR desde 29/10/2026: a view `etd_list` tem
 * uma linha por Factory×Category ativa de lote em produção/pre-loading (docs
 * §3.7.4) e aqui só se lê a página pedida, com busca/filtros/ordenação vindos
 * da URL (./list-params). Antes baixava todas essas linhas e filtrava no app.
 */
export default async function EtdFactoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { profile } = await requireFeature("etd_factories");
  const admin = createAdminClient();
  const state = parseListState(await searchParams);
  const f = state.filters;

  let query = admin.from("etd_list").select("*", { count: "exact" });
  if (f.client_id) query = query.eq("client_id", f.client_id);
  if (f.status) query = query.eq("batch_status", f.status);
  if (f.factory_id) query = query.eq("factory_id", f.factory_id);
  if (f.category_id) query = query.eq("category_id", f.category_id);
  for (const [column, from, to] of DATE_RANGES) {
    if (f[from]) query = query.gte(column, f[from]);
    if (f[to]) query = query.lte(column, f[to]);
  }
  if (f.empty_dates === "yes") query = query.is("initial_date", null);
  if (f.empty_dates === "no") query = query.not("initial_date", "is", null);
  if (f.ready_parts) query = query.eq("ready_parts", f.ready_parts === "yes");
  if (state.q) query = query.ilike("po_number", `%${state.q}%`);
  // Vazio no começo na ordem crescente e no fim na decrescente, como a lista
  // antiga (que tratava vazio como o menor valor).
  const asc = !state.sort.desc;
  for (const column of SORT_COLUMNS[state.sort.id]) {
    query = query.order(column, { ascending: asc, nullsFirst: asc });
  }
  if (state.sort.id !== "po_batch") {
    query = query
      .order("po_number_int", { ascending: false })
      .order("batch_seq", { ascending: false });
  }
  const from = (state.page - 1) * PAGE_SIZE;

  // As listas de factory/category/client vêm à parte porque os filtros precisam
  // de TODAS as opções (não só as dos lotes ativos).
  const [page, factoryRes, categoryRes, clientRes] = await Promise.all([
    query.range(from, from + PAGE_SIZE - 1),
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
  if (page.error) throw new Error(`etd_list: ${page.error.message}`);

  const total = page.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Página além do fim (filtro estreitou, link antigo): vai para a última.
  if (state.page > pageCount) {
    redirect(`/etd-factories${listStateToSearch({ ...state, page: pageCount })}`);
  }

  const rows = buildRows(page.data ?? []);

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
      total={total}
      pageCount={pageCount}
      state={state}
      clients={clients}
      factories={factories}
      categories={categories}
      initialColumns={readColumnVisibility(profile.ui_preferences, "etd-factories")}
      initialListState={readListState(profile, "etd-factories")}
    />
  );
}
