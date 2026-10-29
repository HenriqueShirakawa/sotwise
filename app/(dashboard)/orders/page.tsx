import { redirect } from "next/navigation";

import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { readColumnVisibility } from "@/lib/column-prefs";
import { readListState } from "@/lib/list-state";
import { fetchAll } from "@/lib/fetch-all";

import { OrdersClient, type OrderRow } from "./orders-client";
import { PAGE_SIZE, SORT_COLUMNS, listStateToSearch, parseListState } from "./list-params";

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

export const metadata = { title: "Orders" };

/**
 * Lista de Orders — paginada no SERVIDOR desde 29/10/2026: a view `orders_list`
 * monta cada linha no banco (nomes, lotes, ETD, só PO numérico) e aqui só se lê
 * a página pedida, com busca/cliente/filtros/ordenação vindos da URL
 * (./list-params). Antes baixava orders, lotes e ETDs inteiros.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { profile } = await requireFeature("orders");
  const admin = createAdminClient();
  const state = parseListState(await searchParams);
  const f = state.filters;

  let query = admin.from("orders_list").select("*", { count: "exact" });
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
  const from = (state.page - 1) * PAGE_SIZE;

  const [page, buRes, typeRes, clientRes, exporterRes, profileRes] = await Promise.all([
    query.range(from, from + PAGE_SIZE - 1),
    // Cadastros que alimentam os seletores: via fetchAll para nenhum ficar
    // cortado no teto de 1000 do PostgREST (ver lib/fetch-all).
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("business_units").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string; color: string | null }>((from, to) =>
      admin.from("order_types").select("id, name, color").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("clients").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string; acronym: string | null }>((from, to) =>
      admin.from("exporters").select("id, name, acronym").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{
      id: string;
      full_name: string | null;
      status: "active" | "blocked";
      hidden: boolean;
      client_id: string | null;
    }>((from, to) =>
      admin.from("profiles").select("id, full_name, status, hidden, client_id").range(from, to)
    ),
  ]);
  if (page.error) throw new Error(`orders_list: ${page.error.message}`);

  const total = page.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Página além do fim (filtro estreitou, link antigo): vai para a última.
  if (state.page > pageCount) {
    redirect(`/orders${listStateToSearch({ ...state, page: pageCount })}`);
  }

  const rows: OrderRow[] = (page.data ?? []).map((o) => ({
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
  }));

  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name);

  const clients = clientRes.map((c) => ({ id: c.id, name: c.name })).sort(byName);
  const orderTypes = typeRes.map((t) => ({ id: t.id, name: t.name })).sort(byName);
  const businessUnits = buRes.map((b) => ({ id: b.id, name: b.name })).sort(byName);
  const exporters = exporterRes
    .map((e) => ({ id: e.id, name: e.acronym || e.name }))
    .sort(byName);
  const profiles = profileRes
    .filter((p) => p.full_name)
    .map((p) => ({ id: p.id, name: p.full_name as string }))
    .sort(byName);
  // Operational Responsible: só usuário interno em uso — sem bloqueados, ocultos
  // e contas do portal do cliente. (Decisão 29/09: todos os internos, não só os
  // de Company = China — hoje nenhum usuário está marcado como China.)
  const operationalUsers = profileRes
    .filter((p) => p.full_name && p.status === "active" && !p.hidden && !p.client_id)
    .map((p) => ({ id: p.id, name: p.full_name as string }))
    .sort(byName);

  return (
    <OrdersClient
      rows={rows}
      total={total}
      pageCount={pageCount}
      state={state}
      clients={clients}
      orderTypes={orderTypes}
      businessUnits={businessUnits}
      exporters={exporters}
      profiles={profiles}
      operationalUsers={operationalUsers}
      initialColumns={readColumnVisibility(profile.ui_preferences, "orders")}
      initialListState={readListState(profile, "orders")}
    />
  );
}
