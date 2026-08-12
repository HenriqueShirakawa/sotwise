import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { readColumnVisibility } from "@/lib/column-prefs";
import { fetchAll } from "@/lib/fetch-all";
import { PageHeader } from "@/components/page-header";

import { ShipmentsClient, type ShipmentRow } from "./shipments-client";
import type { Ref } from "./filters-modal";

/** shipments.status ('in_transit'|'delivered'|'canceled') → label exibido. */
const STATUS_LABELS: Record<string, string> = {
  in_transit: "In Transit",
  delivered: "Delivered",
  canceled: "Canceled",
};

// Etapas de shipment/PL que alimentam colunas da lista OU campos de filtro.
// `agents`/`consolidation_point` e as datas de BL/ATA/Delivered não aparecem em
// nenhuma coluna — entram só pelos filtros (docs §3.10.2).
const LIST_STEPS = [
  "consolidation_point",
  "port_of_loading",
  "agents",
  "loading_date",
  "shipping_date",
  "bl",
  "eta_brazil",
  "ata_brazil",
  "delivered",
] as const;

type StepRow = {
  pre_loading_id: string;
  step: (typeof LIST_STEPS)[number];
  pol_id: string | null;
  consolidation_point_id: string | null;
  agent_brazil_id: string | null;
  agent_china_id: string | null;
  estimated_date: string | null;
  completed_on: string | null;
};

/** Data que a lista e os filtros usam pra uma etapa já cumprida. */
const stepDate = (s: StepRow | undefined) => s?.completed_on ?? s?.estimated_date ?? null;

export default async function ShipmentsPage() {
  const { profile } = await requireFeature("shipments");
  const admin = createAdminClient();

  // Tabelas inteiras via fetchAll (há ~1.3k shipments) + os cadastros pequenos.
  // Evita cláusulas .in() com milhares de ids (estouram a URL) e o corte em 1000.
  const [
    shipments,
    preLoadings,
    plClients,
    plBatches,
    batches,
    orders,
    steps,
    polRes,
    modelRes,
    clientRes,
    typeRes,
    podRes,
    agentRes,
    carrierRes,
    factoryRes,
    profileRes,
    orderNumbers,
  ] = await Promise.all([
    fetchAll<{
      id: string;
      pre_loading_id: string;
      shipment_model_id: string | null;
      carrier_id: string | null;
      container_number: string | null;
      status: string;
    }>((from, to) =>
      admin
        .from("shipments")
        .select("id, pre_loading_id, shipment_model_id, carrier_id, container_number, status")
        .is("deleted_at", null)
        .range(from, to)
    ),
    fetchAll<{ id: string; pl_number: string; pod_id: string | null; leader_id: string | null }>(
      (from, to) =>
        admin.from("pre_loadings").select("id, pl_number, pod_id, leader_id").range(from, to)
    ),
    fetchAll<{ pre_loading_id: string; client_id: string }>((from, to) =>
      admin.from("pre_loading_clients").select("pre_loading_id, client_id").range(from, to)
    ),
    fetchAll<{ pre_loading_id: string; batch_id: string }>((from, to) =>
      admin.from("pre_loading_batches").select("pre_loading_id, batch_id").range(from, to)
    ),
    fetchAll<{ id: string; order_id: string }>((from, to) =>
      admin.from("batches").select("id, order_id").range(from, to)
    ),
    fetchAll<{ id: string; order_type_id: string | null }>((from, to) =>
      admin.from("orders").select("id, order_type_id").range(from, to)
    ),
    fetchAll<StepRow>((from, to) =>
      admin
        .from("pre_loading_checklist_steps")
        .select(
          "pre_loading_id, step, pol_id, consolidation_point_id, agent_brazil_id, agent_china_id, estimated_date, completed_on"
        )
        .in("step", LIST_STEPS)
        .range(from, to)
        .returns<StepRow[]>()
    ),
    // Cadastros dos filtros: paginados para nenhum ficar cortado no teto de
    // 1000 do PostgREST (ver lib/fetch-all).
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("pols").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("shipment_models").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("clients").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("order_types").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("pods").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("agents").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("carriers").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("factories").select("id, name").is("deleted_at", null).range(from, to)
    ),
    // profiles não tem deleted_at — mesma query das outras telas.
    fetchAll<{ id: string; full_name: string | null }>((from, to) =>
      admin.from("profiles").select("id, full_name").range(from, to)
    ),
    fetchAll<{ id: string; po_number: string }>((from, to) =>
      admin.from("orders").select("id, po_number").is("deleted_at", null).range(from, to)
    ),
  ]);

  const plById = new Map(preLoadings.map((p) => [p.id, p]));
  const plNumberById = new Map(preLoadings.map((p) => [p.id, p.pl_number]));
  const clientNameById = new Map(clientRes.map((c) => [c.id, c.name]));
  const polNameById = new Map(polRes.map((p) => [p.id, p.name]));
  const modelNameById = new Map(modelRes.map((m) => [m.id, m.name]));
  const typeNameById = new Map(typeRes.map((t) => [t.id, t.name]));
  const orderTypeIdByOrder = new Map(orders.map((o) => [o.id, o.order_type_id]));
  const orderIdByBatch = new Map(batches.map((b) => [b.id, b.order_id]));

  const clientNamesByPl = new Map<string, Set<string>>();
  const clientIdsByPl = new Map<string, Set<string>>();
  for (const pc of plClients) {
    const ids = clientIdsByPl.get(pc.pre_loading_id) ?? new Set<string>();
    ids.add(pc.client_id);
    clientIdsByPl.set(pc.pre_loading_id, ids);

    const name = clientNameById.get(pc.client_id);
    if (!name) continue;
    const set = clientNamesByPl.get(pc.pre_loading_id) ?? new Set<string>();
    set.add(name);
    clientNamesByPl.set(pc.pre_loading_id, set);
  }

  const batchCountByPl = new Map<string, number>();
  const typeNamesByPl = new Map<string, Set<string>>();
  const typeIdsByPl = new Map<string, Set<string>>();
  const orderIdsByPl = new Map<string, Set<string>>();
  for (const pb of plBatches) {
    batchCountByPl.set(pb.pre_loading_id, (batchCountByPl.get(pb.pre_loading_id) ?? 0) + 1);
    const orderId = orderIdByBatch.get(pb.batch_id);
    if (orderId) {
      const orderSet = orderIdsByPl.get(pb.pre_loading_id) ?? new Set<string>();
      orderSet.add(orderId);
      orderIdsByPl.set(pb.pre_loading_id, orderSet);
    }
    const typeId = orderId ? orderTypeIdByOrder.get(orderId) : null;
    if (typeId) {
      const idSet = typeIdsByPl.get(pb.pre_loading_id) ?? new Set<string>();
      idSet.add(typeId);
      typeIdsByPl.set(pb.pre_loading_id, idSet);
    }
    const typeName = typeId ? typeNameById.get(typeId) : null;
    if (typeName) {
      const set = typeNamesByPl.get(pb.pre_loading_id) ?? new Set<string>();
      set.add(typeName);
      typeNamesByPl.set(pb.pre_loading_id, set);
    }
  }

  const stepsByPl = new Map<string, Partial<Record<string, StepRow>>>();
  for (const s of steps) {
    const entry = stepsByPl.get(s.pre_loading_id) ?? {};
    entry[s.step] = s;
    stepsByPl.set(s.pre_loading_id, entry);
  }

  const rows: ShipmentRow[] = shipments.map((s) => {
    const st = stepsByPl.get(s.pre_loading_id) ?? {};
    const pl = plById.get(s.pre_loading_id);
    const polId = st.port_of_loading?.pol_id ?? null;
    const agentsStep = st.agents;
    return {
      id: s.id,
      pl_number: plNumberById.get(s.pre_loading_id) ?? "—",
      client: [...(clientNamesByPl.get(s.pre_loading_id) ?? [])].sort().join(", ") || null,
      client_ids: [...(clientIdsByPl.get(s.pre_loading_id) ?? [])],
      order_type: [...(typeNamesByPl.get(s.pre_loading_id) ?? [])].sort().join(", ") || null,
      order_type_ids: [...(typeIdsByPl.get(s.pre_loading_id) ?? [])],
      order_ids: [...(orderIdsByPl.get(s.pre_loading_id) ?? [])],
      leader_id: pl?.leader_id ?? null,
      pol: polId ? (polNameById.get(polId) ?? null) : null,
      pol_id: polId,
      pod_id: pl?.pod_id ?? null,
      consolidation_point_id: st.consolidation_point?.consolidation_point_id ?? null,
      agent_brazil_id: agentsStep?.agent_brazil_id ?? null,
      agent_china_id: agentsStep?.agent_china_id ?? null,
      carrier_id: s.carrier_id,
      container_number: s.container_number,
      ship_model: s.shipment_model_id ? (modelNameById.get(s.shipment_model_id) ?? null) : null,
      shipment_model_id: s.shipment_model_id,
      loading_date: st.loading_date?.estimated_date ?? st.loading_date?.completed_on ?? null,
      ship_date: st.shipping_date?.completed_on ?? st.shipping_date?.estimated_date ?? null,
      eta: st.eta_brazil?.estimated_date ?? st.eta_brazil?.completed_on ?? null,
      // Só filtráveis — não têm coluna na lista (docs §3.10.2).
      bl_date: stepDate(st.bl),
      ata_date: stepDate(st.ata_brazil),
      delivered_date: stepDate(st.delivered),
      sum_of_orders: batchCountByPl.get(s.pre_loading_id) ?? 0,
      status: STATUS_LABELS[s.status] ?? s.status,
      status_value: s.status,
    };
  });

  // PL number decrescente (igual às outras listas).
  rows.sort((a, b) => (Number(b.pl_number) || 0) - (Number(a.pl_number) || 0));

  const byName = (a: Ref, b: Ref) => a.name.localeCompare(b.name);
  const toRefs = (list: { id: string; name: string }[]) =>
    list.map((r) => ({ id: r.id, name: r.name })).sort(byName);

  return (
    <div>
      <PageHeader title="Shipments" />
      <ShipmentsClient
        rows={rows}
        initialColumns={readColumnVisibility(profile.ui_preferences, "shipments")}
        clients={toRefs(clientRes)}
        profiles={profileRes
          .filter((p) => p.full_name)
          .map((p) => ({ id: p.id, name: p.full_name as string }))
          .sort(byName)}
        orders={orderNumbers
          .map((o) => ({ id: o.id, name: o.po_number }))
          .sort((a, b) => (Number(b.name) || 0) - (Number(a.name) || 0))}
        orderTypes={toRefs(typeRes)}
        agents={toRefs(agentRes)}
        carriers={toRefs(carrierRes)}
        pols={toRefs(polRes)}
        pods={toRefs(podRes)}
        factories={toRefs(factoryRes)}
        shipmentModels={toRefs(modelRes)}
      />
    </div>
  );
}
