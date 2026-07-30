import { verifySession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";

import { ShipmentsClient, type ShipmentRow } from "./shipments-client";

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

/** shipments.status ('in_transit'|'delivered'|'canceled') → label exibido. */
const STATUS_LABELS: Record<string, string> = {
  in_transit: "In Transit",
  delivered: "Delivered",
  canceled: "Canceled",
};

// As etapas de shipment/PL que alimentam colunas de data/POL da lista.
const LIST_STEPS = ["port_of_loading", "loading_date", "shipping_date", "eta_brazil"] as const;

type StepRow = {
  pre_loading_id: string;
  step: string;
  pol_id: string | null;
  estimated_date: string | null;
  completed_on: string | null;
};

export default async function ShipmentsPage() {
  await verifySession();
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
  ] = await Promise.all([
    fetchAll<{ id: string; pre_loading_id: string; shipment_model_id: string | null; status: string }>(
      (from, to) =>
        admin
          .from("shipments")
          .select("id, pre_loading_id, shipment_model_id, status")
          .is("deleted_at", null)
          .range(from, to)
    ),
    fetchAll<{ id: string; pl_number: string }>((from, to) =>
      admin.from("pre_loadings").select("id, pl_number").range(from, to)
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
        .select("pre_loading_id, step, pol_id, estimated_date, completed_on")
        .in("step", LIST_STEPS)
        .range(from, to)
        .returns<StepRow[]>()
    ),
    admin.from("pols").select("id, name").is("deleted_at", null),
    admin.from("shipment_models").select("id, name").is("deleted_at", null),
    admin.from("clients").select("id, name").is("deleted_at", null),
    admin.from("order_types").select("id, name").is("deleted_at", null),
  ]);

  const plNumberById = new Map(preLoadings.map((p) => [p.id, p.pl_number]));
  const clientNameById = new Map((clientRes.data ?? []).map((c) => [c.id, c.name]));
  const polNameById = new Map((polRes.data ?? []).map((p) => [p.id, p.name]));
  const modelNameById = new Map((modelRes.data ?? []).map((m) => [m.id, m.name]));
  const typeNameById = new Map((typeRes.data ?? []).map((t) => [t.id, t.name]));
  const orderTypeIdByOrder = new Map(orders.map((o) => [o.id, o.order_type_id]));
  const orderIdByBatch = new Map(batches.map((b) => [b.id, b.order_id]));

  const clientNamesByPl = new Map<string, Set<string>>();
  for (const pc of plClients) {
    const name = clientNameById.get(pc.client_id);
    if (!name) continue;
    const set = clientNamesByPl.get(pc.pre_loading_id) ?? new Set<string>();
    set.add(name);
    clientNamesByPl.set(pc.pre_loading_id, set);
  }

  const batchCountByPl = new Map<string, number>();
  const typeNamesByPl = new Map<string, Set<string>>();
  for (const pb of plBatches) {
    batchCountByPl.set(pb.pre_loading_id, (batchCountByPl.get(pb.pre_loading_id) ?? 0) + 1);
    const orderId = orderIdByBatch.get(pb.batch_id);
    const typeId = orderId ? orderTypeIdByOrder.get(orderId) : null;
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
    const polId = st.port_of_loading?.pol_id ?? null;
    return {
      id: s.id,
      pl_number: plNumberById.get(s.pre_loading_id) ?? "—",
      client: [...(clientNamesByPl.get(s.pre_loading_id) ?? [])].sort().join(", ") || null,
      order_type: [...(typeNamesByPl.get(s.pre_loading_id) ?? [])].sort().join(", ") || null,
      pol: polId ? (polNameById.get(polId) ?? null) : null,
      ship_model: s.shipment_model_id ? (modelNameById.get(s.shipment_model_id) ?? null) : null,
      loading_date: st.loading_date?.estimated_date ?? st.loading_date?.completed_on ?? null,
      ship_date: st.shipping_date?.completed_on ?? st.shipping_date?.estimated_date ?? null,
      eta: st.eta_brazil?.estimated_date ?? st.eta_brazil?.completed_on ?? null,
      sum_of_orders: batchCountByPl.get(s.pre_loading_id) ?? 0,
      status: STATUS_LABELS[s.status] ?? s.status,
    };
  });

  // PL number decrescente (igual às outras listas).
  rows.sort((a, b) => (Number(b.pl_number) || 0) - (Number(a.pl_number) || 0));

  return (
    <div>
      <PageHeader title="Shipments" />
      <ShipmentsClient rows={rows} />
    </div>
  );
}
