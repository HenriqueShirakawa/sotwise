import type { OrderStatus } from "@/types/database";

/**
 * Estado da lista de Orders na URL (2026-10-29): página, busca, cliente,
 * ordenação e filtros viram query string — a página do servidor lê só a fatia
 * pedida da view `orders_list`. Sem "use client": usado dos dois lados.
 */
export type OrdersFilters = {
  client_reference: string;
  business_unit_id: string;
  order_type_id: string;
  leader_id: string;
  operational_responsible_id: string;
  exporter_id: string;
  status: OrderStatus | "";
  create_date_from: string;
  create_date_to: string;
  etd_from: string;
  etd_to: string;
  schedule_from: string;
  schedule_to: string;
};

export const EMPTY_FILTERS: OrdersFilters = {
  client_reference: "",
  business_unit_id: "",
  order_type_id: "",
  leader_id: "",
  operational_responsible_id: "",
  exporter_id: "",
  status: "",
  create_date_from: "",
  create_date_to: "",
  etd_from: "",
  etd_to: "",
  schedule_from: "",
  schedule_to: "",
};

export const PAGE_SIZE = 10;

/** Colunas ordenáveis → coluna da view. */
export const SORT_COLUMNS = {
  bu: "bu",
  type: "type",
  client: "client",
  po_number: "po_number_int",
  client_reference: "client_reference",
  operational_responsible: "operational_responsible",
  leader: "leader",
  requester: "requester",
  exporter: "exporter",
  date_create: "date_create",
  status: "status_text",
  schedule_requested: "schedule_requested",
} as const;

export type SortId = keyof typeof SORT_COLUMNS;
export type ListState = {
  page: number;
  q: string;
  /** Nome do cliente do seletor da barra ("" = All clients). */
  client: string;
  sort: { id: SortId; desc: boolean };
  filters: OrdersFilters;
};

/** PO number decrescente (1512, 1511, …) — igual ao Bubble. */
export const DEFAULT_SORT: ListState["sort"] = { id: "po_number", desc: true };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseListState(params: Params): ListState {
  const page = Math.max(1, Number.parseInt(one(params.page), 10) || 1);
  const [sortId, dir] = one(params.sort).split(".");
  const sort =
    sortId in SORT_COLUMNS ? { id: sortId as SortId, desc: dir !== "asc" } : DEFAULT_SORT;
  const filters = { ...EMPTY_FILTERS };
  for (const key of Object.keys(EMPTY_FILTERS) as (keyof OrdersFilters)[]) {
    (filters as Record<string, string>)[key] = one(params[key]).trim();
  }
  return { page, q: one(params.q).trim(), client: one(params.client).trim(), sort, filters };
}

/** Query string do estado — omite o que é padrão, pra URL ficar curta. */
export function listStateToSearch(state: ListState): string {
  const sp = new URLSearchParams();
  if (state.q) sp.set("q", state.q);
  if (state.client) sp.set("client", state.client);
  for (const [key, value] of Object.entries(state.filters)) if (value) sp.set(key, value);
  if (state.sort.id !== DEFAULT_SORT.id || state.sort.desc !== DEFAULT_SORT.desc) {
    sp.set("sort", `${state.sort.id}.${state.sort.desc ? "desc" : "asc"}`);
  }
  if (state.page > 1) sp.set("page", String(state.page));
  const s = sp.toString();
  return s ? `?${s}` : "";
}
