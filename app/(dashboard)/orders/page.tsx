import { verifySession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";

import { OrdersClient, type OrderRow } from "./orders-client";

// Mostra os 200 orders mais recentes (paginação server-side completa é follow-up).
const ORDERS_LIMIT = 200;

export default async function OrdersPage() {
  await verifySession();
  const admin = createAdminClient();

  const { data: orders } = await admin
    .from("orders")
    .select(
      "id, po_number, order_type_id, business_unit_id, client_id, client_reference, requester_id, exporter_id, leader_id, status, schedule_requested, created_at"
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(ORDERS_LIMIT);

  const orderList = orders ?? [];
  const orderIds = orderList.map((o) => o.id);

  const [batchesRes, buRes, typeRes, clientRes, exporterRes, profileRes] =
    await Promise.all([
      orderIds.length
        ? admin
            .from("batches")
            .select("order_id, batch_number")
            .in("order_id", orderIds)
        : Promise.resolve({ data: [] as { order_id: string; batch_number: string }[] }),
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
  for (const b of batchesRes.data ?? []) {
    const arr = batchesByOrder.get(b.order_id) ?? [];
    arr.push(b.batch_number);
    batchesByOrder.set(b.order_id, arr);
  }

  const rows: OrderRow[] = orderList.map((o) => {
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
    };
  });

  const clients = (clientRes.data ?? [])
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return <OrdersClient rows={rows} clients={clients} />;
}
