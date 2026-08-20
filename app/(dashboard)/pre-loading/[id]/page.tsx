import { notFound } from "next/navigation";

import { requireFeature } from "@/lib/dal";
import { isStepChecked, plStepFacts } from "@/lib/checklist-completion";
import { fetchAll } from "@/lib/fetch-all";
import { readViewPrefs } from "@/lib/view-prefs";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BatchStatus, ChecklistStep } from "@/types/database";

import {
  PlChecklistClient,
  type PlBatchRow,
  type PlStepRow,
  type Ref,
  type StepAttachment,
} from "./pl-checklist-client";

/** As 7 etapas da fase pre-loading, na ordem do Bubble (docs §3.9.5). */
const STEP_ORDER: ChecklistStep[] = [
  "consolidation_point",
  "city",
  "port_of_loading",
  "shipping_docs",
  "agents",
  "booking",
  "loading_date",
];

type StepRow = {
  id: string;
  step: ChecklistStep;
  done: boolean;
  estimated_date: string | null;
  responsible_id: string | null;
  completed_on: string | null;
  signed_by_id: string | null;
  notes: string | null;
  consolidation_point_id: string | null;
  city_id: string | null;
  pol_id: string | null;
  carrier_id: string | null;
  agent_brazil_id: string | null;
  agent_china_id: string | null;
  contact_brazil_id: string | null;
  contact_china_id: string | null;
  booking_number: string | null;
};

/** Etapa ainda não gravada no banco: um PL novo não tem nenhuma linha. */
function emptyStep(step: ChecklistStep): PlStepRow {
  return {
    step,
    done: false,
    attachments: [],
    estimated_date: null,
    responsible_id: null,
    completed_on: null,
    signed_by_id: null,
    notes: null,
    consolidation_point_id: null,
    city_id: null,
    pol_id: null,
    carrier_id: null,
    agent_brazil_id: null,
    agent_china_id: null,
    contact_brazil_id: null,
    contact_china_id: null,
    booking_number: null,
  };
}

export const metadata = { title: "Pre-loading" };

export default async function PreLoadingChecklistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId, profile } = await requireFeature("pre_loading");
  const { id } = await params;
  const admin = createAdminClient();

  const { data: pl } = await admin
    .from("pre_loadings")
    .select(
      "id, pl_number, created_date, client_reference, pod_id, leader_id, responsible_signer_id, booking_status, seal_number, shipping_confirmed_at"
    )
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!pl) notFound();

  const [
    podRes,
    profileRes,
    plClientsRes,
    plBatchesRes,
    stepsRes,
    factoryRes,
    cityRes,
    polRes,
    cityPolRes,
    agentRes,
    contactRes,
    agentContactRes,
    clientRes,
    shipmentModelRes,
    carrierRes,
  ] = await Promise.all([
    pl.pod_id
      ? admin.from("pods").select("name").eq("id", pl.pod_id).single()
      : Promise.resolve({ data: null }),
    fetchAll<{ id: string; full_name: string | null }>((from, to) =>
      admin.from("profiles").select("id, full_name").range(from, to)
    ),
    admin.from("pre_loading_clients").select("client_id, clients(name)").eq("pre_loading_id", id),
    admin
      .from("pre_loading_batches")
      .select("batch_id, batches(id, batch_number, status, orders(po_number, client_id))")
      .eq("pre_loading_id", id),
    admin
      .from("pre_loading_checklist_steps")
      .select(
        "id, step, done, estimated_date, responsible_id, completed_on, signed_by_id, notes, " +
          "consolidation_point_id, city_id, pol_id, carrier_id, agent_brazil_id, " +
          "agent_china_id, contact_brazil_id, contact_china_id, booking_number"
      )
      .eq("pre_loading_id", id)
      .returns<StepRow[]>(),
    // Cadastros e vínculos dos seletores desta tela: paginados para nenhum ficar
    // cortado no teto de 1000 do PostgREST (ver lib/fetch-all).
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("factories").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("cities").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("pols").select("id, name").is("deleted_at", null).range(from, to)
    ),
    // Cada `pol` é (cidade, porto): city_pols dá a cidade que distingue linhas de
    // mesmo nome de porto, usada para filtrar o seletor de POL (ver §9.3).
    fetchAll<{ pol_id: string; city_id: string }>((from, to) =>
      admin.from("city_pols").select("pol_id, city_id").range(from, to)
    ),
    fetchAll<{ id: string; name: string; location: string | null }>((from, to) =>
      admin.from("agents").select("id, name, location").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("contacts").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ agent_id: string; contact_id: string }>((from, to) =>
      admin.from("agent_contacts").select("agent_id, contact_id").range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("clients").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("shipment_models").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("carriers").select("id, name").is("deleted_at", null).range(from, to)
    ),
  ]);

  const profileNameById = new Map(profileRes.map((p) => [p.id, p.full_name]));

  type ClientEmbed = { client_id: string; clients: { name: string } | null };
  const clients = ((plClientsRes.data ?? []) as unknown as ClientEmbed[])
    .map((c) => c.clients?.name)
    .filter((n): n is string => !!n)
    .sort();

  type BatchEmbed = {
    batches: {
      id: string;
      batch_number: string;
      status: BatchStatus;
      orders: { po_number: string; client_id: string | null } | null;
    } | null;
  };
  const clientNameById = new Map(clientRes.map((c) => [c.id, c.name]));

  const batches: PlBatchRow[] = ((plBatchesRes.data ?? []) as unknown as BatchEmbed[])
    .map((row) => row.batches)
    .filter((b): b is NonNullable<BatchEmbed["batches"]> => !!b)
    .map((b) => ({
      id: b.id,
      client: b.orders?.client_id ? (clientNameById.get(b.orders.client_id) ?? null) : null,
      po_number: b.orders?.po_number ?? "—",
      batch_number: b.batch_number,
      status: b.status,
    }))
    .sort(
      (a, b) =>
        (Number(a.po_number) || 0) - (Number(b.po_number) || 0) ||
        a.batch_number.localeCompare(b.batch_number, undefined, { numeric: true })
    );

  // As 7 etapas sempre aparecem, mesmo as que ainda não existem no banco —
  // elas nascem no primeiro save/anexo (ver savePreLoadingStep).
  const stepRows = stepsRes.data ?? [];
  const stepIds = stepRows.map((s) => s.id);
  const attachmentsRes = stepIds.length
    ? await admin
        .from("step_attachments")
        .select("id, pre_loading_step_id, file_name, file_path")
        .in("pre_loading_step_id", stepIds)
        .order("created_at")
    : { data: [] };

  const attachmentsByStepId = new Map<string, StepAttachment[]>();
  for (const a of attachmentsRes.data ?? []) {
    if (!a.pre_loading_step_id) continue;
    const arr = attachmentsByStepId.get(a.pre_loading_step_id) ?? [];
    arr.push({ id: a.id, file_name: a.file_name, file_path: a.file_path });
    attachmentsByStepId.set(a.pre_loading_step_id, arr);
  }

  // Quantos contatos cada agente tem: a etapa Agents só exige Contact Brazil /
  // Contact China quando o agente escolhido tem algum cadastrado.
  const contactCountByAgent: Record<string, number> = {};
  for (const ac of agentContactRes) {
    contactCountByAgent[ac.agent_id] = (contactCountByAgent[ac.agent_id] ?? 0) + 1;
  }

  const byStep = new Map(stepRows.map((s) => [s.step, s]));
  const steps: PlStepRow[] = STEP_ORDER.map((step) => {
    const s = byStep.get(step);
    if (!s) return emptyStep(step);
    const attachments = attachmentsByStepId.get(s.id) ?? [];
    return {
      ...emptyStep(step),
      ...s,
      // Cada etapa tem sua condição de conclusão (ver lib/checklist-completion):
      // data + cadastro escolhido / documento / número de booking.
      done: isStepChecked(step, plStepFacts(s, attachments.length, contactCountByAgent)),
      attachments,
    };
  });

  const byName = (a: Ref, b: Ref) => a.name.localeCompare(b.name);
  const allAgents = agentRes;
  const contactNameById = new Map(contactRes.map((c) => [c.id, c.name]));
  // city_pols é usada como 1-1 (um pol, uma cidade — §9.3); se algum dia houver
  // 2+, fica a última, o suficiente para o filtro do seletor.
  const cityByPol = new Map(cityPolRes.map((cp) => [cp.pol_id, cp.city_id]));

  // Contatos por agente (via agent_contacts) — alimenta Contact Brazil/China.
  const contactsByAgent: Record<string, Ref[]> = {};
  for (const ac of agentContactRes) {
    const name = contactNameById.get(ac.contact_id);
    if (!name) continue;
    (contactsByAgent[ac.agent_id] ??= []).push({ id: ac.contact_id, name });
  }
  for (const list of Object.values(contactsByAgent)) list.sort(byName);

  // Entradas Factory×Category dos lotes do PL — alimentam a tabela do modal
  // Confirm Shipping (uma linha por entrada, com status de carregamento).
  const plBatchIds = ((plBatchesRes.data ?? []) as unknown as { batch_id: string }[]).map(
    (r) => r.batch_id
  );
  type OfcLineEmbed = {
    id: string;
    batch_id: string;
    ship_requirement: string | null;
    factories: { name: string } | null;
    categories: { name: string } | null;
    orders: { po_number: string } | null;
    batches: { batch_number: string } | null;
    etd_info: { initial_date: string | null } | { initial_date: string | null }[] | null;
  };
  const ofcLinesRes = plBatchIds.length
    ? await admin
        .from("order_factory_category")
        .select(
          "id, batch_id, ship_requirement, factories(name), categories(name), orders(po_number), batches(batch_number), etd_info(initial_date)"
        )
        .in("batch_id", plBatchIds)
        .returns<OfcLineEmbed[]>()
    : { data: [] as OfcLineEmbed[] };
  const shipmentLines = (ofcLinesRes.data ?? []).map((o) => {
    const etd = Array.isArray(o.etd_info) ? o.etd_info[0] : o.etd_info;
    return {
      id: o.id,
      batch_id: o.batch_id,
      ship_requirement: o.ship_requirement,
      factory: o.factories?.name ?? "—",
      category: o.categories?.name ?? "—",
      etd_initial: etd?.initial_date ?? null,
      po_number: o.orders?.po_number ?? "—",
      batch_number: o.batches?.batch_number ?? "—",
    };
  });

  return (
    <PlChecklistClient
      preLoading={{
        id: pl.id,
        pl_number: pl.pl_number,
        created_date: pl.created_date,
        client_reference: pl.client_reference,
        clients,
        pod: podRes.data?.name ?? null,
        leader: pl.leader_id ? (profileNameById.get(pl.leader_id) ?? null) : null,
        responsible_signer: pl.responsible_signer_id
          ? (profileNameById.get(pl.responsible_signer_id) ?? null)
          : null,
        booking_status: pl.booking_status,
        seal_number: pl.seal_number,
      }}
      batches={batches}
      steps={steps}
      profiles={profileRes
        .filter((p) => p.full_name)
        .map((p) => ({ id: p.id, name: p.full_name as string }))
        .sort(byName)}
      factories={factoryRes.map((f) => ({ id: f.id, name: f.name })).sort(byName)}
      cities={cityRes.map((c) => ({ id: c.id, name: c.name })).sort(byName)}
      pols={polRes
        .map((p) => ({ id: p.id, name: p.name, cityId: cityByPol.get(p.id) ?? null }))
        .sort(byName)}
      agentsBrazil={allAgents
        .filter((a) => a.location === "brazil")
        .map((a) => ({ id: a.id, name: a.name }))
        .sort(byName)}
      agentsChina={allAgents
        .filter((a) => a.location === "china")
        .map((a) => ({ id: a.id, name: a.name }))
        .sort(byName)}
      contactsByAgent={contactsByAgent}
      carriers={carrierRes.map((c) => ({ id: c.id, name: c.name })).sort(byName)}
      shipmentModels={shipmentModelRes
        .map((m) => ({ id: m.id, name: m.name }))
        .sort(byName)}
      shipmentLines={shipmentLines}
      currentUserId={userId}
      preloadingLeaderId={pl.leader_id}
      alreadyShipped={pl.shipping_confirmed_at != null}
      viewPrefs={readViewPrefs(profile.ui_preferences)}
    />
  );
}
