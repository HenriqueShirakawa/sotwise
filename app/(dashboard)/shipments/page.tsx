import { redirect } from "next/navigation";

import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { readColumnVisibility } from "@/lib/column-prefs";
import { readListState } from "@/lib/list-state";
import { PageHeader } from "@/components/page-header";

import { ShipmentsClient } from "./shipments-client";
import { PAGE_SIZE, listStateToSearch, parseListState } from "./list-params";
import { polNameFor, shipmentsListQuery, toShipmentRow } from "./query";

export const metadata = { title: "Shipments" };

/**
 * Lista de Shipments (docs §3.10) — paginada no SERVIDOR desde 29/10/2026: a
 * view `shipments_list` monta cada linha no banco e aqui só se lê a página
 * pedida, com busca/filtros/ordenação vindos da URL (./list-params). Antes a
 * página baixava as tabelas inteiras (~44 mil linhas com o histórico do Bubble).
 */
export default async function ShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { profile } = await requireFeature("shipments");
  const admin = createAdminClient();
  const state = parseListState(await searchParams);

  // Só a página pedida, com o total para "Page X of Y". As opções dos filtros
  // NÃO vêm aqui: o cliente as carrega uma vez, à parte (./filter-options.ts) —
  // antes iam em toda troca de página (~50 kB: 1,6 mil orders, 800 fábricas…).
  const from = (state.page - 1) * PAGE_SIZE;
  const polName = await polNameFor(admin, state);
  const { data, count, error } = await shipmentsListQuery(admin, state, polName, {
    count: "exact",
  }).range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error(`shipments_list: ${error.message}`);

  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Página além do fim (filtro estreitou, link antigo): vai para a última.
  if (state.page > pageCount) {
    redirect(`/shipments${listStateToSearch({ ...state, page: pageCount })}`);
  }

  const rows = (data ?? []).map(toShipmentRow);

  return (
    <div>
      <PageHeader title="Shipments" />
      <ShipmentsClient
        rows={rows}
        total={total}
        pageCount={pageCount}
        state={state}
        initialColumns={readColumnVisibility(profile.ui_preferences, "shipments")}
        initialListState={readListState(profile, "shipments")}
      />
    </div>
  );
}
