import { redirect } from "next/navigation";

import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { readColumnVisibility } from "@/lib/column-prefs";
import { fetchAll } from "@/lib/fetch-all";
import { PageHeader } from "@/components/page-header";

import { ShipmentsClient, type ShipmentRow } from "./shipments-client";
import type { Ref } from "./filters-modal";
import { PAGE_SIZE, SORT_COLUMNS, listStateToSearch, parseListState } from "./list-params";

/** shipments.status ('in_transit'|'delivered'|'canceled') → label exibido. */
const STATUS_LABELS: Record<string, string> = {
  in_transit: "In Transit",
  delivered: "Delivered",
  canceled: "Canceled",
};

/** Filtros de range de data → coluna da view `shipments_list`. */
const DATE_RANGES = [
  ["loading_date", "loading_from", "loading_to"],
  ["ship_date", "ship_from", "ship_to"],
  ["bl_date", "bl_from", "bl_to"],
  ["eta", "eta_from", "eta_to"],
  ["ata_date", "ata_from", "ata_to"],
  ["delivered_date", "delivered_from", "delivered_to"],
] as const;

/** Filtros de igualdade simples → coluna da view. */
const EQUALS = [
  "status",
  "leader_id",
  "agent_brazil_id",
  "agent_china_id",
  "carrier_id",
  "consolidation_point_id",
  "pod_id",
  "shipment_model_id",
] as const;

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
  const f = state.filters;

  // Cadastros dos filtros: paginados para nenhum ficar cortado no teto de 1000
  // do PostgREST (ver lib/fetch-all).
  const [
    polRes,
    modelRes,
    clientRes,
    typeRes,
    podRes,
    agentRes,
    carrierRes,
    factoryRes,
    profileRes,
    orderNumbers,
  ] = await Promise.all([
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("pols").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("shipment_models").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("clients").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("order_types").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("pods").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("agents").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("carriers").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("factories").select("id, name").is("deleted_at", null).range(from, to)
    ),
    // profiles não tem deleted_at — mesma query das outras telas.
    fetchAll<{ id: string; full_name: string | null }>((from, to) =>
      admin.from("profiles").select("id, full_name").range(from, to)
    ),
    fetchAll<{ id: string; po_number: string }>((from, to) =>
      admin.from("orders").select("id, po_number").is("deleted_at", null).range(from, to)
    ),
  ]);

  // Só a página pedida, com o total para "Page X of Y".
  let query = admin.from("shipments_list").select("*", { count: "exact" });
  if (f.client_id) query = query.contains("client_ids", [f.client_id]);
  if (f.order_id) query = query.contains("order_ids", [f.order_id]);
  if (f.order_type_id) query = query.contains("order_type_ids", [f.order_type_id]);
  for (const key of EQUALS) if (f[key]) query = query.eq(key, f[key]);
  if (f.container_number) query = query.ilike("container_number", `%${f.container_number}%`);
  // pol é (cidade, porto) desnormalizado: o mesmo porto tem várias linhas (Ningbo
  // 12×, INTEGRACAO_GSS §9.3) — o filtro casa pelo NOME do porto.
  if (f.pol_id) {
    const polName = polRes.find((p) => p.id === f.pol_id)?.name.trim();
    query = polName ? query.ilike("pol", polName) : query.eq("pol_id", f.pol_id);
  }
  for (const [column, from, to] of DATE_RANGES) {
    if (f[from]) query = query.gte(column, f[from]);
    if (f[to]) query = query.lte(column, f[to]);
  }
  if (state.q) query = query.ilike("pl_number", `%${state.q}%`);
  // Vazio no fim na ordem decrescente e no começo na crescente — como a lista
  // antiga, que ordenava "" junto dos textos.
  const asc = !state.sort.desc;
  query = query.order(SORT_COLUMNS[state.sort.id], { ascending: asc, nullsFirst: asc });
  if (state.sort.id !== "pl_number") query = query.order("pl_number_int", { ascending: false });
  const from = (state.page - 1) * PAGE_SIZE;
  const { data, count, error } = await query.range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error(`shipments_list: ${error.message}`);

  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Página além do fim (filtro estreitou, link antigo): vai para a última.
  if (state.page > pageCount) {
    redirect(`/shipments${listStateToSearch({ ...state, page: pageCount })}`);
  }

  const rows: ShipmentRow[] = (data ?? []).map((s) => ({
    id: s.id,
    pl_number: s.pl_number,
    client: s.client,
    client_reference: s.client_reference,
    order_type: s.order_type,
    pol: s.pol,
    ship_model: s.ship_model,
    loading_date: s.loading_date,
    ship_date: s.ship_date,
    eta: s.eta,
    sum_of_orders: s.sum_of_orders,
    orders_summary: s.orders_summary,
    status: STATUS_LABELS[s.status] ?? s.status,
  }));

  const byName = (a: Ref, b: Ref) => a.name.localeCompare(b.name);
  const toRefs = (list: { id: string; name: string }[]) =>
    list.map((r) => ({ id: r.id, name: r.name })).sort(byName);

  return (
    <div>
      <PageHeader title="Shipments" />
      <ShipmentsClient
        rows={rows}
        total={total}
        pageCount={pageCount}
        state={state}
        initialColumns={readColumnVisibility(profile.ui_preferences, "shipments")}
        clients={toRefs(clientRes)}
        profiles={profileRes
          .filter((p) => p.full_name)
          .map((p) => ({ id: p.id, name: p.full_name as string }))
          .sort(byName)}
        orders={orderNumbers
          .map((o) => ({ id: o.id, name: o.po_number }))
          .sort((a, b) => (Number(b.name) || 0) - (Number(a.name) || 0))}
        orderTypes={toRefs(typeRes)}
        agents={toRefs(agentRes)}
        carriers={toRefs(carrierRes)}
        pols={toRefs(polRes)}
        pods={toRefs(podRes)}
        factories={toRefs(factoryRes)}
        shipmentModels={toRefs(modelRes)}
      />
    </div>
  );
}
