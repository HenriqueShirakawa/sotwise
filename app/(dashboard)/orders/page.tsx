import { verifySession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";

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

export default async function OrdersPage() {
  await verifySession();
  const admin = createAdminClient();

  const [orders, batches, buRes, typeRes, clientRes, exporterRes, profileRes] =
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
      fetchAll<{ order_id: string; batch_number: string }>((from, to) =>
        admin.from("batches").select("order_id, batch_number").range(from, to)
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

  const batchesByOrder = new Map<string, string[]>();
  for (const b of batches) {
    const arr = batchesByOrder.get(b.order_id) ?? [];
    arr.push(b.batch_number);
    batchesByOrder.set(b.order_id, arr);
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
      batches: (batchesByOrder.get(o.id) ?? []).sort(),
      leader: o.leader_id ? profileMap.get(o.leader_id) ?? null : null,
      requester: o.requester_id ? profileMap.get(o.requester_id) ?? null : null,
      exporter: o.exporter_id ? exporterMap.get(o.exporter_id) ?? null : null,
      date_create: o.created_at,
      status: o.status,
      schedule_requested: o.schedule_requested,
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
    />
  );
}
