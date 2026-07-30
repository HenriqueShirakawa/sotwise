import { verifySession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { readColumnVisibility } from "@/lib/column-prefs";

import { OrdersClient, type OrderRow } from "./orders-client";

const PAGE = 1000; // limite de linhas por request do PostgREST

/** Busca TODAS as linhas de uma query paginando em blocos de 1000. */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await build(from, from + PAGE - 1);
    const chunk = data ?? [];
    all.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return all;
}

// ETD do pedido = menor "Initial date" entre suas entradas Factory×Category.
// Em vez de baixar order_factory_category inteiro (9.485 linhas) só pra mapear
// ofc→order, embutimos o order_id no próprio etd_info (inner join) — traz só as
// ~878 linhas de ETD com initial_date.
type EtdOrderRow = {
  initial_date: string | null;
  order_factory_category: { order_id: string } | { order_id: string }[] | null;
};

export default async function OrdersPage() {
  const { profile } = await verifySession();
  const admin = createAdminClient();

  const [orders, batches, etdRows, buRes, typeRes, clientRes, exporterRes, profileRes] =
    await Promise.all([
      fetchAll<{
        id: string;
        po_number: string;
        order_type_id: string | null;
        business_unit_id: string | null;
        client_id: string | null;
        client_reference: string | null;
        requester_id: string | null;
        exporter_id: string | null;
        leader_id: string | null;
        status: OrderRow["status"];
        schedule_requested: string | null;
        created_at: string;
      }>((from, to) =>
        admin
          .from("orders")
          .select(
            "id, po_number, order_type_id, business_unit_id, client_id, client_reference, requester_id, exporter_id, leader_id, status, schedule_requested, created_at"
          )
          .is("deleted_at", null)
          .order("po_number", { ascending: false })
          .range(from, to)
      ),
      fetchAll<{
        order_id: string;
        batch_number: string;
        status: OrderRow["batches"][number]["status"];
      }>((from, to) =>
        admin.from("batches").select("order_id, batch_number, status").range(from, to)
      ),
      fetchAll<EtdOrderRow>((from, to) =>
        admin
          .from("etd_info")
          .select("initial_date, order_factory_category!inner(order_id)")
          .not("initial_date", "is", null)
          .range(from, to)
          .returns<EtdOrderRow[]>()
      ),
      admin.from("business_units").select("id, name").is("deleted_at", null),
      admin.from("order_types").select("id, name, color").is("deleted_at", null),
      admin.from("clients").select("id, name").is("deleted_at", null),
      admin.from("exporters").select("id, name, acronym").is("deleted_at", null),
      admin.from("profiles").select("id, full_name"),
    ]);

  const buMap = new Map((buRes.data ?? []).map((b) => [b.id, b.name]));
  const typeMap = new Map(
    (typeRes.data ?? []).map((t) => [t.id, { name: t.name, color: t.color }])
  );
  const clientMap = new Map((clientRes.data ?? []).map((c) => [c.id, c.name]));
  const exporterMap = new Map(
    (exporterRes.data ?? []).map((e) => [e.id, e.acronym || e.name])
  );
  const profileMap = new Map(
    (profileRes.data ?? []).map((p) => [p.id, p.full_name])
  );

  const batchesByOrder = new Map<string, OrderRow["batches"]>();
  for (const b of batches) {
    const arr = batchesByOrder.get(b.order_id) ?? [];
    arr.push({ batch_number: b.batch_number, status: b.status });
    batchesByOrder.set(b.order_id, arr);
  }

  // ETD do pedido = menor "Initial date" entre as entradas Factory x Category
  // dele (ver docs/regras_de_negocio.md §3.7.4) — usado só pro filtro da lista.
  const etdByOrder = new Map<string, string>();
  for (const e of etdRows) {
    if (!e.initial_date) continue;
    const ofc = Array.isArray(e.order_factory_category)
      ? e.order_factory_category[0]
      : e.order_factory_category;
    const orderId = ofc?.order_id;
    if (!orderId) continue;
    const current = etdByOrder.get(orderId);
    if (!current || e.initial_date < current) etdByOrder.set(orderId, e.initial_date);
  }

  const rows: OrderRow[] = orders.map((o) => {
    const type = o.order_type_id ? typeMap.get(o.order_type_id) : undefined;
    return {
      id: o.id,
      po_number: o.po_number,
      bu: o.business_unit_id ? buMap.get(o.business_unit_id) ?? null : null,
      type: type?.name ?? null,
      type_color: type?.color ?? null,
      client: o.client_id ? clientMap.get(o.client_id) ?? null : null,
      client_reference: o.client_reference,
      batches: (batchesByOrder.get(o.id) ?? []).sort((a, b) =>
        a.batch_number.localeCompare(b.batch_number)
      ),
      leader: o.leader_id ? profileMap.get(o.leader_id) ?? null : null,
      requester: o.requester_id ? profileMap.get(o.requester_id) ?? null : null,
      exporter: o.exporter_id ? exporterMap.get(o.exporter_id) ?? null : null,
      date_create: o.created_at,
      status: o.status,
      schedule_requested: o.schedule_requested,
      etd: etdByOrder.get(o.id) ?? null,
      order_type_id: o.order_type_id,
      client_id: o.client_id,
      business_unit_id: o.business_unit_id,
      requester_id: o.requester_id,
      exporter_id: o.exporter_id,
      leader_id: o.leader_id,
    };
  });

  // ordena por número de PO decrescente (1512, 1511, …) — igual ao Bubble
  rows.sort((a, b) => (Number(b.po_number) || 0) - (Number(a.po_number) || 0));

  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name);

  const clients = (clientRes.data ?? [])
    .map((c) => ({ id: c.id, name: c.name }))
    .sort(byName);
  const orderTypes = (typeRes.data ?? [])
    .map((t) => ({ id: t.id, name: t.name }))
    .sort(byName);
  const businessUnits = (buRes.data ?? [])
    .map((b) => ({ id: b.id, name: b.name }))
    .sort(byName);
  const exporters = (exporterRes.data ?? [])
    .map((e) => ({ id: e.id, name: e.acronym || e.name }))
    .sort(byName);
  const profiles = (profileRes.data ?? [])
    .filter((p) => p.full_name)
    .map((p) => ({ id: p.id, name: p.full_name as string }))
    .sort(byName);

  return (
    <OrdersClient
      rows={rows}
      clients={clients}
      orderTypes={orderTypes}
      businessUnits={businessUnits}
      exporters={exporters}
      profiles={profiles}
      initialColumns={readColumnVisibility(profile.ui_preferences, "orders")}
    />
  );
}
