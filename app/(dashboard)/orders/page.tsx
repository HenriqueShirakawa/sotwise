import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { readColumnVisibility } from "@/lib/column-prefs";
import { fetchAll } from "@/lib/fetch-all";

import { OrdersClient, type OrderRow } from "./orders-client";

// ETD do pedido = menor "Initial date" entre suas entradas Factory×Category.
// Em vez de baixar order_factory_category inteiro (9.485 linhas) só pra mapear
// ofc→order, embutimos o order_id no próprio etd_info (inner join) — traz só as
// ~878 linhas de ETD com initial_date.
type EtdOrderRow = {
  initial_date: string | null;
  order_factory_category: { order_id: string } | { order_id: string }[] | null;
};

type OrderListRow = {
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
};

/**
 * Regra de visibilidade (2026-08-25): order criada a partir deste instante só
 * aparece na lista se tiver ≥1 linha Factory×Category. As anteriores ficam
 * "grandfathered" (sempre visíveis) — não escondemos as ~388 orders migradas
 * que nasceram sem F×C. O corte é a data em que a regra entrou.
 */
const NEW_ORDER_CUTOFF = new Date("2026-08-25T00:00:00Z");

export const metadata = { title: "Orders" };

export default async function OrdersPage() {
  const { profile } = await requireFeature("orders");
  const admin = createAdminClient();

  const [orders, batches, etdRows, buRes, typeRes, clientRes, exporterRes, profileRes, ofcOrderIdRows] =
    await Promise.all([
      fetchAll<OrderListRow>((from, to) =>
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
      fetchAll<{ id: string; full_name: string | null }>((from, to) =>
        admin.from("profiles").select("id, full_name").range(from, to)
      ),
      // order_ids que têm ≥1 Factory×Category — base da regra de visibilidade.
      fetchAll<{ order_id: string }>((from, to) =>
        admin.from("order_factory_category").select("order_id").range(from, to)
      ),
    ]);

  const ordersWithFactoryCategory = new Set(ofcOrderIdRows.map((r) => r.order_id));

  const buMap = new Map(buRes.map((b) => [b.id, b.name]));
  const typeMap = new Map(typeRes.map((t) => [t.id, { name: t.name, color: t.color }]));
  const clientMap = new Map(clientRes.map((c) => [c.id, c.name]));
  const exporterMap = new Map(exporterRes.map((e) => [e.id, e.acronym || e.name]));
  const profileMap = new Map(profileRes.map((p) => [p.id, p.full_name]));

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

  const rows: OrderRow[] = orders
    // Regra de visibilidade: order nova (>= corte) só aparece com ≥1 F×C; as
    // anteriores ao corte ficam sempre visíveis (não escondemos as migradas).
    .filter(
      (o) =>
        new Date(o.created_at) < NEW_ORDER_CUTOFF ||
        ordersWithFactoryCategory.has(o.id)
    )
    .map((o) => {
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
