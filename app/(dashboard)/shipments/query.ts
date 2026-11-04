import type { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

import type { ShipmentRow } from "./shipments-client";
import { SORT_COLUMNS, type ListState } from "./list-params";

type Admin = ReturnType<typeof createAdminClient>;
type ShipmentsListRow = Database["public"]["Views"]["shipments_list"]["Row"];

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

/**
 * Query da lista de Shipments com busca/filtros/ordenação da URL — usada pela
 * página (paginada) e pelo Download XLSX (./export, todas as linhas), para o
 * arquivo sempre bater com a tela. Síncrona de propósito (o builder do
 * PostgREST é "thenable": devolvê-lo de uma função async já o executaria);
 * o nome do POL vem antes, de `polNameFor`.
 */
export function shipmentsListQuery(
  admin: Admin,
  state: ListState,
  polName: string | null,
  opts: { count?: "exact" } = {}
) {
  const f = state.filters;
  let query = admin.from("shipments_list").select("*", opts.count ? { count: opts.count } : undefined);
  if (f.client_id) query = query.contains("client_ids", [f.client_id]);
  if (f.order_id) query = query.contains("order_ids", [f.order_id]);
  if (f.order_type_id) query = query.contains("order_type_ids", [f.order_type_id]);
  for (const key of EQUALS) if (f[key]) query = query.eq(key, f[key]);
  if (f.container_number) query = query.ilike("container_number", `%${f.container_number}%`);
  // pol é (cidade, porto) desnormalizado: o mesmo porto tem várias linhas (Ningbo
  // 12×, INTEGRACAO_GSS §9.3) — o filtro casa pelo NOME do porto.
  if (f.pol_id) query = polName ? query.ilike("pol", polName) : query.eq("pol_id", f.pol_id);
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
  // Desempate final estável para o fatiamento em blocos (fetchAll).
  return query.order("id");
}

/** Nome do porto do filtro POL (o filtro casa pelo nome — ver shipmentsListQuery). */
export async function polNameFor(admin: Admin, state: ListState): Promise<string | null> {
  if (!state.filters.pol_id) return null;
  const { data: pol } = await admin.from("pols").select("name").eq("id", state.filters.pol_id).maybeSingle();
  return pol?.name.trim() || null;
}

export function toShipmentRow(s: ShipmentsListRow): ShipmentRow {
  return {
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
  };
}
