/**
 * Estado da lista de Shipments na URL (2026-10-29): página, busca, ordenação e
 * filtros viram query string — a página do servidor lê só a fatia pedida da view
 * `shipments_list`. Sem "use client": usado dos dois lados (server page e client).
 */
export type ShipmentFilters = {
  client_id: string;
  status: string;
  leader_id: string;
  order_id: string;
  order_type_id: string;
  agent_brazil_id: string;
  agent_china_id: string;
  carrier_id: string;
  container_number: string;
  consolidation_point_id: string;
  pol_id: string;
  pod_id: string;
  shipment_model_id: string;
  loading_from: string;
  loading_to: string;
  ship_from: string;
  ship_to: string;
  bl_from: string;
  bl_to: string;
  eta_from: string;
  eta_to: string;
  ata_from: string;
  ata_to: string;
  delivered_from: string;
  delivered_to: string;
};

export const EMPTY_FILTERS: ShipmentFilters = {
  client_id: "",
  status: "",
  leader_id: "",
  order_id: "",
  order_type_id: "",
  agent_brazil_id: "",
  agent_china_id: "",
  carrier_id: "",
  container_number: "",
  consolidation_point_id: "",
  pol_id: "",
  pod_id: "",
  shipment_model_id: "",
  loading_from: "",
  loading_to: "",
  ship_from: "",
  ship_to: "",
  bl_from: "",
  bl_to: "",
  eta_from: "",
  eta_to: "",
  ata_from: "",
  ata_to: "",
  delivered_from: "",
  delivered_to: "",
};

export const PAGE_SIZE = 10;

/** Colunas ordenáveis → coluna da view. */
export const SORT_COLUMNS = {
  pl_number: "pl_number_int",
  client: "client",
  client_reference: "client_reference",
  order_type: "order_type",
  pol: "pol",
  ship_model: "ship_model",
  loading_date: "loading_date",
  ship_date: "ship_date",
  eta: "eta",
  sum_of_orders: "sum_of_orders",
  status: "status",
} as const;

export type SortId = keyof typeof SORT_COLUMNS;
export type ListState = {
  page: number;
  q: string;
  sort: { id: SortId; desc: boolean };
  filters: ShipmentFilters;
};

export const DEFAULT_SORT: ListState["sort"] = { id: "pl_number", desc: true };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseListState(params: Params): ListState {
  const page = Math.max(1, Number.parseInt(one(params.page), 10) || 1);
  const [sortId, dir] = one(params.sort).split(".");
  const sort =
    sortId in SORT_COLUMNS ? { id: sortId as SortId, desc: dir !== "asc" } : DEFAULT_SORT;
  const filters = { ...EMPTY_FILTERS };
  for (const key of Object.keys(EMPTY_FILTERS) as (keyof ShipmentFilters)[]) {
    filters[key] = one(params[key]).trim();
  }
  return { page, q: one(params.q).trim(), sort, filters };
}

/** Query string do estado — omite o que é padrão, pra URL ficar curta. */
export function listStateToSearch(state: ListState): string {
  const sp = new URLSearchParams();
  if (state.q) sp.set("q", state.q);
  for (const [key, value] of Object.entries(state.filters)) if (value) sp.set(key, value);
  if (state.sort.id !== DEFAULT_SORT.id || state.sort.desc !== DEFAULT_SORT.desc) {
    sp.set("sort", `${state.sort.id}.${state.sort.desc ? "desc" : "asc"}`);
  }
  if (state.page > 1) sp.set("page", String(state.page));
  const s = sp.toString();
  return s ? `?${s}` : "";
}
