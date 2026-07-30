import { notFound } from "next/navigation";

import { verifySession } from "@/lib/dal";
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
  consolidation_point_id: string | null;
  city_id: string | null;
  pol_id: string | null;
  carrier_agent_id: string | null;
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
    consolidation_point_id: null,
    city_id: null,
    pol_id: null,
    carrier_agent_id: null,
    agent_brazil_id: null,
    agent_china_id: null,
    contact_brazil_id: null,
    contact_china_id: null,
    booking_number: null,
  };
}

export default async function PreLoadingChecklistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await verifySession();
  const { id } = await params;
  const admin = createAdminClient();

  const { data: pl } = await admin
    .from("pre_loadings")
    .select(
      "id, pl_number, created_date, client_reference, pod_id, leader_id, responsible_signer_id, booking_status, seal_number"
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
    agentRes,
    contactRes,
    agentContactRes,
    clientRes,
  ] = await Promise.all([
    pl.pod_id
      ? admin.from("pods").select("name").eq("id", pl.pod_id).single()
      : Promise.resolve({ data: null }),
    admin.from("profiles").select("id, full_name"),
    admin.from("pre_loading_clients").select("client_id, clients(name)").eq("pre_loading_id", id),
    admin
      .from("pre_loading_batches")
      .select("batch_id, batches(id, batch_number, status, orders(po_number, client_id))")
      .eq("pre_loading_id", id),
    admin
      .from("pre_loading_checklist_steps")
      .select(
        "id, step, done, estimated_date, responsible_id, completed_on, signed_by_id, " +
          "consolidation_point_id, city_id, pol_id, carrier_agent_id, agent_brazil_id, " +
          "agent_china_id, contact_brazil_id, contact_china_id, booking_number"
      )
      .eq("pre_loading_id", id)
      .returns<StepRow[]>(),
    admin.from("factories").select("id, name").is("deleted_at", null),
    admin.from("cities").select("id, name").is("deleted_at", null),
    admin.from("pols").select("id, name").is("deleted_at", null),
    admin.from("agents").select("id, name, location").is("deleted_at", null),
    admin.from("contacts").select("id, name").is("deleted_at", null),
    admin.from("agent_contacts").select("agent_id, contact_id"),
    admin.from("clients").select("id, name").is("deleted_at", null),
  ]);

  const profileNameById = new Map((profileRes.data ?? []).map((p) => [p.id, p.full_name]));

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
  const clientNameById = new Map((clientRes.data ?? []).map((c) => [c.id, c.name]));

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

  const byStep = new Map(stepRows.map((s) => [s.step, s]));
  const steps: PlStepRow[] = STEP_ORDER.map((step) => {
    const s = byStep.get(step);
    if (!s) return emptyStep(step);
    return {
      ...emptyStep(step),
      ...s,
      done: s.completed_on != null,
      attachments: attachmentsByStepId.get(s.id) ?? [],
    };
  });

  const byName = (a: Ref, b: Ref) => a.name.localeCompare(b.name);
  const allAgents = agentRes.data ?? [];
  const contactNameById = new Map((contactRes.data ?? []).map((c) => [c.id, c.name]));

  // Contatos por agente (via agent_contacts) — alimenta Contact Brazil/China.
  const contactsByAgent: Record<string, Ref[]> = {};
  for (const ac of agentContactRes.data ?? []) {
    const name = contactNameById.get(ac.contact_id);
    if (!name) continue;
    (contactsByAgent[ac.agent_id] ??= []).push({ id: ac.contact_id, name });
  }
  for (const list of Object.values(contactsByAgent)) list.sort(byName);

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
      profiles={(profileRes.data ?? [])
        .filter((p) => p.full_name)
        .map((p) => ({ id: p.id, name: p.full_name as string }))
        .sort(byName)}
      factories={(factoryRes.data ?? []).map((f) => ({ id: f.id, name: f.name })).sort(byName)}
      cities={(cityRes.data ?? []).map((c) => ({ id: c.id, name: c.name })).sort(byName)}
      pols={(polRes.data ?? []).map((p) => ({ id: p.id, name: p.name })).sort(byName)}
      agentsBrazil={allAgents
        .filter((a) => a.location === "brazil")
        .map((a) => ({ id: a.id, name: a.name }))
        .sort(byName)}
      agentsChina={allAgents
        .filter((a) => a.location === "china")
        .map((a) => ({ id: a.id, name: a.name }))
        .sort(byName)}
      agents={allAgents.map((a) => ({ id: a.id, name: a.name })).sort(byName)}
      contactsByAgent={contactsByAgent}
    />
  );
}
