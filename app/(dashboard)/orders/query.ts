import type { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

import type { OrderRow } from "./orders-client";
import { PAGE_SIZE, SORT_COLUMNS, type ListState } from "./list-params";

type Admin = ReturnType<typeof createAdminClient>;
type OrdersListRow = Database["public"]["Views"]["orders_list"]["Row"];

/** Filtros de range de data → coluna da view `orders_list`. */
const DATE_RANGES = [
  ["date_create_day", "create_date_from", "create_date_to"],
  ["etd", "etd_from", "etd_to"],
  ["schedule_requested", "schedule_from", "schedule_to"],
] as const;

/** Filtros de igualdade simples → coluna da view. */
const EQUALS = [
  "business_unit_id",
  "order_type_id",
  "leader_id",
  "operational_responsible_id",
  "exporter_id",
  "status",
] as const;

// Sem regra de visibilidade por Factory×Category (removida em 19/10/2026): a
// order criada pelo GSS aparece na lista mesmo antes de ter fábrica/categoria.

/**
 * Query da lista de Orders com busca/cliente/filtros/ordenação da URL — usada
 * pela página (paginada) e pelo Download XLSX (./export, todas as linhas), para
 * o arquivo sempre bater com a tela.
 */
export function ordersListQuery(admin: Admin, state: ListState, opts: { count?: "exact" } = {}) {
  const f = state.filters;
  let query = admin.from("orders_list").select("*", opts.count ? { count: opts.count } : undefined);
  if (state.client) query = query.eq("client", state.client);
  if (f.client_reference) query = query.ilike("client_reference", `%${f.client_reference}%`);
  for (const key of EQUALS) if (f[key]) query = query.eq(key, f[key]);
  for (const [column, from, to] of DATE_RANGES) {
    if (f[from]) query = query.gte(column, f[from]);
    if (f[to]) query = query.lte(column, f[to]);
  }
  if (state.q) {
    // Mesma busca de antes: PO, Client Ref. ou Client. Vírgula, parênteses e
    // asterisco quebram a sintaxe do `or` do PostgREST — saem do termo.
    const q = state.q.replace(/[,()*\\"]/g, " ").trim();
    if (q) query = query.or(`po_number.ilike.*${q}*,client_reference.ilike.*${q}*,client.ilike.*${q}*`);
  }
  // Vazio no começo na ordem crescente e no fim na decrescente, como a lista
  // antiga, que ordenava "" junto dos textos.
  const asc = !state.sort.desc;
  query = query.order(SORT_COLUMNS[state.sort.id], { ascending: asc, nullsFirst: asc });
  if (state.sort.id !== "po_number") query = query.order("po_number_int", { ascending: false });
  // Desempate final estável: sem ele o fatiamento em blocos (fetchAll) pode
  // repetir ou pular linha entre um bloco e outro.
  return query.order("id");
}

export function toOrderRow(o: OrdersListRow): OrderRow {
  return {
    id: o.id,
    po_number: o.po_number,
    bu: o.bu,
    type: o.type,
    type_color: o.type_color,
    client: o.client,
    client_reference: o.client_reference,
    batches: o.batches,
    leader: o.leader,
    operational_responsible: o.operational_responsible,
    requester: o.requester,
    exporter: o.exporter,
    date_create: o.date_create,
    status: o.status,
    schedule_requested: o.schedule_requested,
    etd: o.etd,
    order_type_id: o.order_type_id,
    client_id: o.client_id,
    business_unit_id: o.business_unit_id,
    requester_id: o.requester_id,
    exporter_id: o.exporter_id,
    leader_id: o.leader_id,
    operational_responsible_id: o.operational_responsible_id,
  };
}

export type OrdersPage = {
  rows: OrderRow[];
  total: number;
  pageCount: number;
  /** Página efetivamente servida (pedido além do fim cai na última). */
  page: number;
};

/**
 * Uma página da lista (com o total) — usada pela página (primeira carga) e
 * por ./rows (troca de página sem navegação, 04/11/2026).
 */
export async function fetchOrdersPage(admin: Admin, state: ListState): Promise<OrdersPage> {
  const read = async (page: number) => {
    const from = (page - 1) * PAGE_SIZE;
    const res = await ordersListQuery(admin, state, { count: "exact" }).range(from, from + PAGE_SIZE - 1);
    if (res.error) throw new Error(`orders_list: ${res.error.message}`);
    return res;
  };
  let page = state.page;
  let res = await read(page);
  const total = res.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Página além do fim (filtro estreitou, link antigo): serve a última.
  if (page > pageCount) {
    page = pageCount;
    res = await read(page);
  }
  return { rows: (res.data ?? []).map(toOrderRow), total, pageCount, page };
}
