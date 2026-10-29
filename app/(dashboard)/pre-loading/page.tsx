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

// Etapas que a lista usa (a view pre_loadings_list traz só essas).
type ListStep = "consolidation_point" | "port_of_loading" | "loading_date" | "booking" | "agents";

// Lotes que o modal de criação oferece: em produção (regra confirmada — o PL
// agrupa lotes "In production") mais os que já estão num PL, necessários pra
// reabrir a seleção na edição.
const SELECTABLE_BATCH_STATUSES: BatchStatus[] = ["in_production", "preloading"];

/** Linha da view `pre_loadings_list`: só os PLs abertos, com o que a lista usa
 *  já agregado (20261029140000) — antes a página baixava etapas, lotes, orders
 *  e shipments de TODOS os PLs para descartar quase tudo. */
type PreLoadingBase = {
  id: string;
  pl_number: string;
  created_date: string;
  client_reference: string | null;
  pod_id: string | null;
  leader_id: string | null;
  responsible_signer_id: string | null;
  steps: Partial<Record<ListStep, StepRow>>;
  clients: { id: string; name: string }[];
  batch_ids: string[];
  order_ids: string[];
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
  step: ListStep;
  completed_on: string | null;
  estimated_date: string | null;
  consolidation_point_id: string | null;
  pol_id: string | null;
  agent_brazil_id: string | null;
  agent_china_id: string | null;
  carrier_id: string | null;
  booking_number: string | null;
  cutoff_date: string | null;
  doc_cutoff_date: string | null;
};

export const metadata = { title: "Pre-Loading" };

export default async function PreLoadingPage() {
  const { profile } = await requireFeature("pre_loading");
  const admin = createAdminClient();

  const [
    preLoadings,
    reservedLinks,
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
    // Só os PLs abertos — a regra de saída da lista (Loading Date concluída E
    // embarque criado) está na view.
    fetchAll<PreLoadingBase>((from, to) =>
      admin.from("pre_loadings_list").select("*").range(from, to).returns<PreLoadingBase[]>()
    ),
    // Lote selecionável -> PL vivo que o reservou (reabre a seleção na edição).
    // Os vínculos de um PL apagado (soft delete) liberam o lote de volta.
    fetchAll<{ pre_loading_id: string; batch_id: string }>((from, to) =>
      admin
        .from("pre_loading_batches")
        .select("pre_loading_id, batch_id, batches!inner(status), pre_loadings!inner(deleted_at)")
        .in("batches.status", SELECTABLE_BATCH_STATUSES)
        .is("pre_loadings.deleted_at", null)
        .range(from, to)
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
        .eq("is_active", true)
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
  const plIdByBatchId = new Map(reservedLinks.map((pb) => [pb.batch_id, pb.pre_loading_id]));

  const rows: PreLoadingRow[] = [];
  for (const pl of preLoadings) {
    const steps = pl.steps;
    const loadingDateStep = steps.loading_date;
    // Regra da lista (aplicada na view pre_loadings_list): o PL só sai daqui
    // quando as DUAS coisas acontecem — a etapa "Loading Date" concluída E um
    // embarque criado (Confirm Shipping, com o status de cada linha Factory ×
    // Category). Só a data preenchida sumia com o PL antes de ele virar
    // Shipment, e o trabalho ficava sem tela.

    const consPointId = steps.consolidation_point?.consolidation_point_id ?? null;
    const polId = steps.port_of_loading?.pol_id ?? null;
    const agentsStep = steps.agents;
    // O Carrier agora é escolha direta na etapa Agents (antes era derivado do
    // agente via carrier_agents). Mantido como array de 1 p/ o filtro da lista.
    const carrierIds = agentsStep?.carrier_id ? [agentsStep.carrier_id] : [];
    const plClientsList = pl.clients;
    const plOrderIds = pl.order_ids;

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
      // Container Cut-off e Doc Cut-off da etapa Booking (22/10/2026).
      cutoff: steps.booking?.cutoff_date ?? null,
      doc_cutoff: steps.booking?.doc_cutoff_date ?? null,
      // "Booking Status" = etapa "Booking" do checklist concluída — que exige
      // o booking number (único por PL) além da data (ver lib/checklist-completion).
      booking_confirmed: steps.booking
        ? isStepChecked("booking", plStepFacts(steps.booking, 0))
        : false,
      total_pos: plOrderIds.length,
      order_ids: plOrderIds,
      batch_ids: pl.batch_ids,
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
