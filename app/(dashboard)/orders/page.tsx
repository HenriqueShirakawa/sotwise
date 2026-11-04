import { redirect } from "next/navigation";

import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { readColumnVisibility } from "@/lib/column-prefs";
import { readListState } from "@/lib/list-state";
import { fetchAll } from "@/lib/fetch-all";

import { OrdersClient } from "./orders-client";
import { listStateToSearch, parseListState } from "./list-params";
import { fetchOrdersPage } from "./query";

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

  const [page, buRes, typeRes, clientRes, exporterRes, profileRes] = await Promise.all([
    fetchOrdersPage(admin, state),
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
  // Página além do fim (filtro estreitou, link antigo): vai para a última.
  if (page.page !== state.page) {
    redirect(`/orders${listStateToSearch({ ...state, page: page.page })}`);
  }

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
      rows={page.rows}
      total={page.total}
      pageCount={page.pageCount}
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
