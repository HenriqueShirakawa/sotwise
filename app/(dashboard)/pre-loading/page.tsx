import { requireFeature } from "@/lib/dal";
import { isStepChecked, plStepFacts } from "@/lib/checklist-completion";
import { fetchAll } from "@/lib/fetch-all";
import { todayIso } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { readColumnVisibility } from "@/lib/column-prefs";

import { PreLoadingClient, type PreLoadingRow } from "./pre-loading-client";

// Etapas que a lista usa (a view pre_loadings_list traz só essas).
type ListStep = "consolidation_point" | "port_of_loading" | "loading_date" | "booking" | "agents";

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

  // Só o que monta as linhas. Opções dos filtros e do modal de criação (lotes
  // selecionáveis, próximo nº de PL) vêm à parte, depois que a lista aparece
  // (./options e ./actions) — antes iam todas no render (~50 kB, 29/10/2026).
  const [preLoadings, podRes, factoryRes, polRes, profileRes] = await Promise.all([
    // Só os PLs abertos — a regra de saída da lista (Loading Date concluída E
    // embarque criado) está na view.
    fetchAll<PreLoadingBase>((from, to) =>
      admin.from("pre_loadings_list").select("*").range(from, to).returns<PreLoadingBase[]>()
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("pods").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("factories").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("pols").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; full_name: string | null }>((from, to) =>
      admin.from("profiles").select("id, full_name").range(from, to)
    ),
  ]);

  const podNameById = new Map(podRes.map((p) => [p.id, p.name]));
  const factoryNameById = new Map(factoryRes.map((f) => [f.id, f.name]));
  const polNameById = new Map(polRes.map((p) => [p.id, p.name]));
  const profileNameById = new Map(profileRes.map((p) => [p.id, p.full_name]));

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

  return (
    <PreLoadingClient
      rows={rows}
      today={todayIso()}
      initialColumns={readColumnVisibility(profile.ui_preferences, "pre-loading")}
    />
  );
}
