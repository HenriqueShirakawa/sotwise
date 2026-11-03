import { redirect } from "next/navigation";

import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { readColumnVisibility } from "@/lib/column-prefs";
import { fetchAll } from "@/lib/fetch-all";

import { EtdFactoriesClient } from "./etd-factories-client";
import { PAGE_SIZE, listStateToSearch, parseListState } from "./list-params";
import { buildEtdRows, etdListQuery } from "./query";

export const metadata = { title: "ETD factories" };

/**
 * ETD Factories — paginada no SERVIDOR desde 29/10/2026: a view `etd_list` tem
 * uma linha por Factory×Category ativa de lote em produção/pre-loading (docs
 * §3.7.4) e aqui só se lê a página pedida, com busca/filtros/ordenação vindos
 * da URL (./list-params, aplicados em ./query). Antes baixava todas essas
 * linhas e filtrava no app.
 */
export default async function EtdFactoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { profile } = await requireFeature("etd_factories");
  const admin = createAdminClient();
  const state = parseListState(await searchParams);

  const query = etdListQuery(admin, state, { count: "exact" });
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

  const rows = buildEtdRows(page.data ?? []);

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
    />
  );
}
