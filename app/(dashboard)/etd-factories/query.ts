import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { daysDelay, gapOfReady } from "@/lib/etd";
import type { Database } from "@/types/database";

import type { EtdFactoryRow } from "./etd-factories-client";
import { SORT_COLUMNS, type ListState } from "./list-params";

type EtdListRow = Database["public"]["Views"]["etd_list"]["Row"];

/** Filtros de range de data → coluna da view `etd_list`. */
const DATE_RANGES = [
  ["shipment_req", "shipment_from", "shipment_to"],
  ["initial_date", "initial_from", "initial_to"],
  ["current_date", "current_from", "current_to"],
  ["last_updated_day", "updated_from", "updated_to"],
] as const;

/**
 * Query da view `etd_list` com busca/filtros/ordenação do estado da URL. Usada
 * pela página (que corta só a página pedida) e pelo Download XLS (que lê
 * tudo) — os dois têm de devolver exatamente as mesmas linhas, na mesma ordem.
 */
export function etdListQuery(
  admin: ReturnType<typeof createAdminClient>,
  state: ListState,
  { count }: { count?: "exact" } = {}
) {
  const f = state.filters;
  let query = admin.from("etd_list").select("*", { count });
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
  // Desempate estável: sem ele, linhas empatadas podem trocar de página entre
  // um range e outro (e o XLS, que pagina de 1000 em 1000, repetiria/perderia linha).
  return query.order("id");
}

/** Monta as linhas exibidas — separado do componente pra manter o `Date.now()`
 * (impuro) fora do corpo de uma função que o React Compiler trata como componente. */
export function buildEtdRows(list: EtdListRow[]): EtdFactoryRow[] {
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
