import { requireFeature } from "@/lib/dal";
import { isStepChecked, plStepFacts } from "@/lib/checklist-completion";
import { fetchAll } from "@/lib/fetch-all";
import { todayIso } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { readColumnVisibility } from "@/lib/column-prefs";
import type { BatchStatus } from "@/types/database";

import { PreLoadingClient, type PreLoadingRow } from "./pre-loading-client";
import type { BatchOption } from "./pre-loading-form-modal";
import type { Ref } from "./filters-modal";

const LIST_STEPS = [
  "consolidation_point",
  "port_of_loading",
  "loading_date",
  "booking",
  "agents",
] as const;

// Lotes que o modal de criação oferece: em produção (regra confirmada — o PL
// agrupa lotes "In production") mais os que já estão num PL, necessários pra
// reabrir a seleção na edição.
const SELECTABLE_BATCH_STATUSES: BatchStatus[] = ["in_production", "preloading"];

type PreLoadingBase = {
  id: string;
  pl_number: string;
  created_date: string;
  client_reference: string | null;
  pod_id: string | null;
  leader_id: string | null;
  responsible_signer_id: string | null;
};

type SelectableBatchRow = {
  id: string;
  order_id: string;
  batch_number: string;
  status: BatchStatus;
  orders: { po_number: string; client_id: string | null } | null;
};

type OfcBatchRow = {
  batch_id: string | null;
  factory_id: string;
  category_id: string;
};

type StepRow = {
  pre_loading_id: string;
  step: (typeof LIST_STEPS)[number];
  completed_on: string | null;
  estimated_date: string | null;
  consolidation_point_id: string | null;
  pol_id: string | null;
  agent_brazil_id: string | null;
  agent_china_id: string | null;
  carrier_id: string | null;
  booking_number: string | null;
};

export const metadata = { title: "Pre-Loading" };

export default async function PreLoadingPage() {
  const { profile } = await requireFeature("pre_loading");
  const admin = createAdminClient();

  const [
    preLoadings,
    shipmentRows,
    stepRows,
    plClients,
    plBatches,
    batchRes,
    orderRes,
    podRes,
    factoryRes,
    polRes,
    clientRes,
    profileRes,
    agentRes,
    carrierRes,
    plNumbersAll,
    selectableBatches,
    ofcByBatch,
    categoryRes,
  ] = await Promise.all([
    fetchAll<PreLoadingBase>((from, to) =>
      admin
        .from("pre_loadings")
        .select(
          "id, pl_number, created_date, client_reference, pod_id, leader_id, responsible_signer_id"
        )
        .is("deleted_at", null)
        .range(from, to)
    ),
    // Quem já virou embarque: junto com a Loading Date concluída, é o que tira
    // o PL desta lista (o filtro em si está no laço lá embaixo).
    fetchAll<{ pre_loading_id: string }>((from, to) =>
      admin.from("shipments").select("pre_loading_id").is("deleted_at", null).range(from, to)
    ),
    fetchAll<StepRow>((from, to) =>
      admin
        .from("pre_loading_checklist_steps")
        .select(
          "pre_loading_id, step, completed_on, estimated_date, consolidation_point_id, pol_id, agent_brazil_id, agent_china_id, carrier_id, booking_number"
        )
        .in("step", LIST_STEPS)
        .range(from, to)
        .returns<StepRow[]>()
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
    fetchAll<{ id: string; po_number: string }>((from, to) =>
      admin.from("orders").select("id, po_number").is("deleted_at", null).range(from, to)
    ),
    // Cadastros dos seletores e dos filtros: paginados para nenhum ficar cortado
    // no teto de 1000 do PostgREST (ver lib/fetch-all).
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("pods").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("factories").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("pols").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("clients").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; full_name: string | null }>((from, to) =>
      admin.from("profiles").select("id, full_name").range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("agents").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("carriers").select("id, name").is("deleted_at", null).range(from, to)
    ),
    // Inclui os soft-deleted: `pl_number` é unique, número não se reaproveita.
    fetchAll<{ pl_number: string }>((from, to) =>
      admin.from("pre_loadings").select("pl_number").range(from, to)
    ),
    fetchAll<SelectableBatchRow>((from, to) =>
      admin
        .from("batches")
        .select("id, order_id, batch_number, status, orders!inner(po_number, client_id)")
        .in("status", SELECTABLE_BATCH_STATUSES)
        .is("orders.deleted_at", null)
        .range(from, to)
        .returns<SelectableBatchRow[]>()
    ),
    fetchAll<OfcBatchRow>((from, to) =>
      admin
        .from("order_factory_category")
        .select("batch_id, factory_id, category_id, batches!inner(status)")
        .in("batches.status", SELECTABLE_BATCH_STATUSES)
        .range(from, to)
        .returns<OfcBatchRow[]>()
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("categories").select("id, name").is("deleted_at", null).range(from, to)
    ),
  ]);

  const podNameById = new Map(podRes.map((p) => [p.id, p.name]));
  const factoryNameById = new Map(factoryRes.map((f) => [f.id, f.name]));
  const polNameById = new Map(polRes.map((p) => [p.id, p.name]));
  const clientNameById = new Map(clientRes.map((c) => [c.id, c.name]));
  const profileNameById = new Map(profileRes.map((p) => [p.id, p.full_name]));
  const orderIdByBatchId = new Map(batchRes.map((b) => [b.id, b.order_id]));

  const stepsByPreLoading = new Map<string, Partial<Record<(typeof LIST_STEPS)[number], StepRow>>>();
  for (const s of stepRows) {
    const entry = stepsByPreLoading.get(s.pre_loading_id) ?? {};
    entry[s.step] = s;
    stepsByPreLoading.set(s.pre_loading_id, entry);
  }

  const clientsByPreLoading = new Map<string, { id: string; name: string }[]>();
  for (const pc of plClients) {
    const arr = clientsByPreLoading.get(pc.pre_loading_id) ?? [];
    const name = clientNameById.get(pc.client_id);
    if (name) arr.push({ id: pc.client_id, name });
    clientsByPreLoading.set(pc.pre_loading_id, arr);
  }

  const orderIdsByPreLoading = new Map<string, Set<string>>();
  const batchIdsByPreLoading = new Map<string, string[]>();
  // Lote -> PL que o reservou. Só vínculos de PLs vivos: os de um PL apagado
  // (soft delete) liberam o lote de volta pra seleção.
  const livePlIds = new Set(preLoadings.map((p) => p.id));
  const plIdByBatchId = new Map<string, string>();
  for (const pb of plBatches) {
    if (!livePlIds.has(pb.pre_loading_id)) continue;
    plIdByBatchId.set(pb.batch_id, pb.pre_loading_id);
    const batches = batchIdsByPreLoading.get(pb.pre_loading_id) ?? [];
    batches.push(pb.batch_id);
    batchIdsByPreLoading.set(pb.pre_loading_id, batches);

    const orderId = orderIdByBatchId.get(pb.batch_id);
    if (!orderId) continue;
    const set = orderIdsByPreLoading.get(pb.pre_loading_id) ?? new Set<string>();
    set.add(orderId);
    orderIdsByPreLoading.set(pb.pre_loading_id, set);
  }

  const shippedPlIds = new Set(shipmentRows.map((s) => s.pre_loading_id));

  const rows: PreLoadingRow[] = [];
  for (const pl of preLoadings) {
    const steps = stepsByPreLoading.get(pl.id) ?? {};
    const loadingDateStep = steps.loading_date;
    // Regra da lista: o PL só sai daqui quando as DUAS coisas acontecem — a
    // etapa "Loading Date" concluída E um embarque criado (Confirm Shipping,
    // com o status de cada linha Factory × Category). Só a data preenchida
    // sumia com o PL antes de ele virar Shipment, e o trabalho ficava sem tela.
    if (loadingDateStep?.completed_on && shippedPlIds.has(pl.id)) continue;

    const consPointId = steps.consolidation_point?.consolidation_point_id ?? null;
    const polId = steps.port_of_loading?.pol_id ?? null;
    const agentsStep = steps.agents;
    // O Carrier agora é escolha direta na etapa Agents (antes era derivado do
    // agente via carrier_agents). Mantido como array de 1 p/ o filtro da lista.
    const carrierIds = agentsStep?.carrier_id ? [agentsStep.carrier_id] : [];
    const plClientsList = clientsByPreLoading.get(pl.id) ?? [];
    const plOrderIds = [...(orderIdsByPreLoading.get(pl.id) ?? [])];

    rows.push({
      id: pl.id,
      pl_number: pl.pl_number,
      created_date: pl.created_date,
      client: plClientsList.map((c) => c.name).sort().join(", ") || null,
      client_ids: plClientsList.map((c) => c.id),
      client_reference: pl.client_reference,
      responsible_signer_id: pl.responsible_signer_id,
      leader: pl.leader_id ? (profileNameById.get(pl.leader_id) ?? null) : null,
      leader_id: pl.leader_id,
      consolidation_point: consPointId ? (factoryNameById.get(consPointId) ?? null) : null,
      consolidation_point_id: consPointId,
      pol: polId ? (polNameById.get(polId) ?? null) : null,
      pol_id: polId,
      pod: pl.pod_id ? (podNameById.get(pl.pod_id) ?? null) : null,
      pod_id: pl.pod_id,
      // Data da etapa "Loading Date": a de conclusão quando existe (o PL segue
      // na lista até virar embarque), senão a estimada. "Preloading completed?"
      // é essa mesma conclusão.
      loading_date: loadingDateStep?.completed_on ?? loadingDateStep?.estimated_date ?? null,
      completed: !!loadingDateStep?.completed_on,
      // "Booking Status" = etapa "Booking" do checklist concluída — que exige
      // o booking number além da data (ver lib/checklist-completion).
      booking_confirmed: steps.booking
        ? isStepChecked("booking", plStepFacts(steps.booking, 0))
        : false,
      total_pos: orderIdsByPreLoading.get(pl.id)?.size ?? 0,
      order_ids: plOrderIds,
      batch_ids: batchIdsByPreLoading.get(pl.id) ?? [],
      agent_brazil_id: agentsStep?.agent_brazil_id ?? null,
      agent_china_id: agentsStep?.agent_china_id ?? null,
      carrier_ids: carrierIds,
    });
  }

  // Ordenação padrão: PL number decrescente — igual ao Bubble.
  rows.sort((a, b) => (Number(b.pl_number) || 0) - (Number(a.pl_number) || 0));

  const byName = (a: Ref, b: Ref) => a.name.localeCompare(b.name);
  const clients: Ref[] = clientRes.map((c) => ({ id: c.id, name: c.name })).sort(byName);
  const profiles: Ref[] = profileRes
    .filter((p) => p.full_name)
    .map((p) => ({ id: p.id, name: p.full_name as string }))
    .sort(byName);
  const agents: Ref[] = agentRes.map((a) => ({ id: a.id, name: a.name })).sort(byName);
  const carriers: Ref[] = carrierRes.map((c) => ({ id: c.id, name: c.name })).sort(byName);
  const pols: Ref[] = polRes.map((p) => ({ id: p.id, name: p.name })).sort(byName);
  const pods: Ref[] = podRes.map((p) => ({ id: p.id, name: p.name })).sort(byName);
  const factories: Ref[] = factoryRes.map((f) => ({ id: f.id, name: f.name })).sort(byName);
  const orders: Ref[] = orderRes
    .map((o) => ({ id: o.id, name: o.po_number }))
    .sort((a, b) => (Number(b.name) || 0) - (Number(a.name) || 0));

  // Entradas Factory×Category por lote — coluna "Factories Number" da seleção.
  const categoryNameById = new Map(categoryRes.map((c) => [c.id, c.name]));
  const entriesByBatchId = new Map<string, { factory: string; category: string }[]>();
  for (const ofc of ofcByBatch) {
    if (!ofc.batch_id) continue;
    const arr = entriesByBatchId.get(ofc.batch_id) ?? [];
    arr.push({
      factory: factoryNameById.get(ofc.factory_id) ?? "—",
      category: categoryNameById.get(ofc.category_id) ?? "—",
    });
    entriesByBatchId.set(ofc.batch_id, arr);
  }

  const batchOptions: BatchOption[] = selectableBatches.map((b) => ({
    id: b.id,
    order_id: b.order_id,
    po_number: b.orders?.po_number ?? "—",
    batch_number: b.batch_number,
    status: b.status,
    client: b.orders?.client_id ? (clientNameById.get(b.orders.client_id) ?? null) : null,
    client_id: b.orders?.client_id ?? null,
    pre_loading_id: plIdByBatchId.get(b.id) ?? null,
    entries: entriesByBatchId.get(b.id) ?? [],
  }));

  const maxPl = plNumbersAll.reduce((max, p) => {
    const n = Number(p.pl_number);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);

  return (
    <PreLoadingClient
      rows={rows}
      clients={clients}
      profiles={profiles}
      agents={agents}
      carriers={carriers}
      pols={pols}
      pods={pods}
      factories={factories}
      orders={orders}
      batchOptions={batchOptions}
      nextPlNumber={String(maxPl + 1)}
      today={todayIso()}
      initialColumns={readColumnVisibility(profile.ui_preferences, "pre-loading")}
    />
  );
}
