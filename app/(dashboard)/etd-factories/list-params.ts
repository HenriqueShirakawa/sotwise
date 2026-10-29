import type { BatchStatus } from "@/types/database";

/**
 * Estado da lista de ETD Factories na URL (2026-10-29): página, busca,
 * ordenação e filtros viram query string — a página do servidor lê só a fatia
 * pedida da view `etd_list`. Sem "use client": usado dos dois lados.
 */
export type EtdFactoriesFilters = {
  client_id: string;
  status: BatchStatus | "";
  factory_id: string;
  category_id: string;
  shipment_from: string;
  shipment_to: string;
  initial_from: string;
  initial_to: string;
  current_from: string;
  current_to: string;
  updated_from: string;
  updated_to: string;
  empty_dates: "" | "yes" | "no";
  ready_parts: "" | "yes" | "no";
};

export const EMPTY_FILTERS: EtdFactoriesFilters = {
  client_id: "",
  status: "",
  factory_id: "",
  category_id: "",
  shipment_from: "",
  shipment_to: "",
  initial_from: "",
  initial_to: "",
  current_from: "",
  current_to: "",
  updated_from: "",
  updated_to: "",
  empty_dates: "",
  ready_parts: "",
};

export const PAGE_SIZE = 10;

/** Colunas ordenáveis → coluna(s) da view (PO . Batch = PO numérico, depois o lote). */
export const SORT_COLUMNS = {
  client: ["client"],
  po_batch: ["po_number_int", "batch_seq"],
  factory: ["factory"],
  category: ["category"],
  order_date: ["order_date"],
  shipment_req: ["shipment_req"],
  initial_date: ["initial_date"],
  current_date: ["current_date"],
  days_delay: ["days_delay"],
  last_updated: ["last_updated"],
  batch_status: ["batch_status_label"],
  ready_parts: ["ready_parts"],
  gap_of_ready: ["gap_of_ready"],
  inspection: ["inspection"],
  dispatch_location: ["dispatch_location"],
  dispatch_date: ["dispatch_date"],
} as const;

export type SortId = keyof typeof SORT_COLUMNS;
export type ListState = {
  page: number;
  q: string;
  sort: { id: SortId; desc: boolean };
  filters: EtdFactoriesFilters;
};

export const DEFAULT_SORT: ListState["sort"] = { id: "po_batch", desc: true };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseListState(params: Params): ListState {
  const page = Math.max(1, Number.parseInt(one(params.page), 10) || 1);
  const [sortId, dir] = one(params.sort).split(".");
  const sort =
    sortId in SORT_COLUMNS ? { id: sortId as SortId, desc: dir !== "asc" } : DEFAULT_SORT;
  const filters = { ...EMPTY_FILTERS };
  for (const key of Object.keys(EMPTY_FILTERS) as (keyof EtdFactoriesFilters)[]) {
    (filters as Record<string, string>)[key] = one(params[key]).trim();
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
