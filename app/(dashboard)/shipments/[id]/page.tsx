import { notFound } from "next/navigation";

import { requireFeature } from "@/lib/dal";
import {
  hasExtraRequirements,
  isStepChecked,
  missingLabel,
  plStepFacts,
} from "@/lib/checklist-completion";
import { fetchAll } from "@/lib/fetch-all";
import { readViewPrefs } from "@/lib/view-prefs";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BatchStatus, ChecklistStep, LoadingStatus } from "@/types/database";

import {
  ShipmentDetailClient,
  type Ref,
  type ShipmentBatchRow,
  type ShipmentStepRow,
  type StepAttachment,
} from "./shipment-detail-client";
import type { PartRow } from "./view-parts-modal";

/** Timeline completa: #11–17 (herdadas do PL) + #18–24 (fase Shipment). */
const STEP_ORDER: ChecklistStep[] = [
  "consolidation_point",
  "city",
  "port_of_loading",
  "shipping_docs",
  "agents",
  "booking",
  "loading_date",
  "shipping_date",
  "bl",
  "original_docs",
  "inspection_report",
  "eta_brazil",
  "ata_brazil",
  "delivered",
];

const STATUS_LABELS: Record<string, string> = {
  in_transit: "In Transit",
  delivered: "Delivered",
  canceled: "Canceled",
};

type StepRow = {
  id: string;
  step: ChecklistStep;
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

export const metadata = { title: "Shipment" };

export default async function ShipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { permissions, profile, userId, isAdmin, isOwner } = await requireFeature("shipments");
  const { id } = await params;
  const admin = createAdminClient();

  const { data: shipment } = await admin
    .from("shipments")
    .select(
      "id, pre_loading_id, shipment_model_id, carrier_id, container_number, leader_id, signer_id, status"
    )
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!shipment) notFound();

  const { data: pl } = await admin
    .from("pre_loadings")
    .select("id, pl_number, created_date, client_reference, pod_id")
    .eq("id", shipment.pre_loading_id)
    .single();

  if (!pl) notFound();

  const [
    stepsRes,
    plClientsRes,
    plBatchesRes,
    profileRes,
    podRes,
    modelRes,
    carrierRes,
    factoryRes,
    cityRes,
    polRes,
    agentRes,
    contactRes,
    agentContactRes,
    clientRes,
  ] = await Promise.all([
    admin
      .from("pre_loading_checklist_steps")
      .select(
        "id, step, estimated_date, responsible_id, completed_on, signed_by_id, notes, " +
          "consolidation_point_id, city_id, pol_id, carrier_id, agent_brazil_id, " +
          "agent_china_id, contact_brazil_id, contact_china_id, booking_number"
      )
      .eq("pre_loading_id", pl.id)
      .returns<StepRow[]>(),
    admin.from("pre_loading_clients").select("client_id").eq("pre_loading_id", pl.id),
    admin
      .from("pre_loading_batches")
      .select(
        "batch_id, batches(id, batch_number, status, orders(po_number, client_id, date_po))"
      )
      .eq("pre_loading_id", pl.id),
    fetchAll<{ id: string; full_name: string | null }>((from, to) =>
      admin.from("profiles").select("id, full_name").range(from, to)
    ),
    pl.pod_id
      ? admin.from("pods").select("name").eq("id", pl.pod_id).single()
      : Promise.resolve({ data: null }),
    shipment.shipment_model_id
      ? admin.from("shipment_models").select("name").eq("id", shipment.shipment_model_id).single()
      : Promise.resolve({ data: null }),
    // Todos os carriers (id → nome): resolve tanto o carrier do embarque
    // (Transport) quanto o da etapa Agents, que agora é escolha direta.
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("carriers").select("id, name").range(from, to)
    ),
    // Cadastros usados pra resolver os valores das etapas herdadas do PL:
    // paginados para nenhum ficar cortado no teto de 1000 do PostgREST — nome
    // que não vem do mapa apareceria como "—" na tela (ver lib/fetch-all).
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("factories").select("id, name").range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("cities").select("id, name").range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("pols").select("id, name").range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("agents").select("id, name").range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("contacts").select("id, name").range(from, to)
    ),
    // Contatos por agente: a etapa Agents só exige contato quando o agente
    // escolhido tem algum cadastrado (ver lib/checklist-completion).
    fetchAll<{ agent_id: string }>((from, to) =>
      admin.from("agent_contacts").select("agent_id").range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("clients").select("id, name").range(from, to)
    ),
  ]);

  const profileNameById = new Map(profileRes.map((p) => [p.id, p.full_name]));
  const clientNameById = new Map(clientRes.map((c) => [c.id, c.name]));
  const factoryNameById = new Map(factoryRes.map((f) => [f.id, f.name]));
  const cityNameById = new Map(cityRes.map((c) => [c.id, c.name]));
  const polNameById = new Map(polRes.map((p) => [p.id, p.name]));
  const agentNameById = new Map(agentRes.map((a) => [a.id, a.name]));
  const carrierNameById = new Map(carrierRes.map((c) => [c.id, c.name]));
  const contactNameById = new Map(contactRes.map((c) => [c.id, c.name]));
  const contactCountByAgent: Record<string, number> = {};
  for (const ac of agentContactRes) {
    contactCountByAgent[ac.agent_id] = (contactCountByAgent[ac.agent_id] ?? 0) + 1;
  }

  const clients = (plClientsRes.data ?? [])
    .map((c) => clientNameById.get(c.client_id))
    .filter((n): n is string => !!n)
    .sort();

  type BatchEmbed = {
    batches: {
      id: string;
      batch_number: string;
      status: BatchStatus;
      orders: { po_number: string; client_id: string | null; date_po: string | null } | null;
    } | null;
  };
  const batchRows = ((plBatchesRes.data ?? []) as unknown as BatchEmbed[])
    .map((row) => row.batches)
    .filter((b): b is NonNullable<BatchEmbed["batches"]> => !!b);

  // Entradas Factory × Category dos lotes do embarque — chips na tabela e
  // linhas do modal "View parts". `order_id` + ETD acompanham a linha: o modal
  // de ETD (o mesmo da tela ETD Factories) é aberto por entrada, e o dado
  // sobrevive ao split do embarque porque etd_info é 1:1 com a linha.
  const batchIds = batchRows.map((b) => b.id);
  type OfcEmbed = {
    id: string;
    batch_id: string | null;
    order_id: string;
    factory_id: string;
    category_id: string;
    loading_status: LoadingStatus | null;
    etd_info: { initial_date: string | null } | { initial_date: string | null }[] | null;
  };
  // Lotes-filhos do split: no Confirm Shipping, entrada marcada Partial/None sai
  // do lote que embarcou e vai para um lote novo (docs §3.7.2). Quando TODAS as
  // entradas são Partial/None o lote embarcado fica sem nenhuma linha própria —
  // e era o que deixava o "View parts" vazio. As linhas do filho continuam
  // sendo o que aquele lote carregou, então entram aqui pela linhagem.
  // A cadeia pode ter mais de um nível: o lote-filho também embarca e splita de
  // novo, levando a linha para um "neto". Sobe a linhagem inteira até o lote
  // deste embarque (limite defensivo, caso algum dado forme ciclo).
  const shippedAncestorOf = new Map<string, string>();
  const descendantNumberById = new Map<string, string>();
  let frontier = batchIds;
  for (let depth = 0; depth < 10 && frontier.length > 0; depth++) {
    const { data } = await admin
      .from("batches")
      .select("id, batch_number, split_from_batch_id")
      .in("split_from_batch_id", frontier);
    const generation = (data ?? []).filter((b) => !shippedAncestorOf.has(b.id));
    if (generation.length === 0) break;
    for (const b of generation) {
      const parent = b.split_from_batch_id as string;
      shippedAncestorOf.set(b.id, shippedAncestorOf.get(parent) ?? parent);
      descendantNumberById.set(b.id, b.batch_number);
    }
    frontier = generation.map((b) => b.id);
  }

  const lookupIds = [...batchIds, ...shippedAncestorOf.keys()];
  const ofcRes = lookupIds.length
    ? await admin
        .from("order_factory_category")
        .select(
          "id, batch_id, order_id, factory_id, category_id, loading_status, etd_info(initial_date)"
        )
        .in("batch_id", lookupIds)
        .returns<OfcEmbed[]>()
    : { data: [] as OfcEmbed[] };

  const categoryNameById = new Map(
    (
      await fetchAll<{ id: string; name: string }>((from, to) =>
        admin.from("categories").select("id, name").range(from, to)
      )
    ).map((c) => [c.id, c.name])
  );

  const partsByBatch = new Map<string, PartRow[]>();
  for (const o of ofcRes.data ?? []) {
    if (!o.batch_id) continue;
    // Linha que migrou no split é atribuída ao lote de ORIGEM (o que embarcou),
    // marcada com o lote onde ela está hoje.
    const ancestor = shippedAncestorOf.get(o.batch_id);
    const targetBatchId = ancestor ?? o.batch_id;
    const etd = Array.isArray(o.etd_info) ? o.etd_info[0] : o.etd_info;
    const arr = partsByBatch.get(targetBatchId) ?? [];
    arr.push({
      id: o.id,
      order_id: o.order_id,
      factory: factoryNameById.get(o.factory_id) ?? "—",
      category: categoryNameById.get(o.category_id) ?? "—",
      loading_status: o.loading_status,
      etd_initial: etd?.initial_date ?? null,
      moved_to: ancestor ? (descendantNumberById.get(o.batch_id) ?? null) : null,
    });
    partsByBatch.set(targetBatchId, arr);
  }
  for (const list of partsByBatch.values()) {
    list.sort((a, b) => a.factory.localeCompare(b.factory) || a.category.localeCompare(b.category));
  }

  const batches: ShipmentBatchRow[] = batchRows
    .map((b) => ({
      id: b.id,
      client: b.orders?.client_id ? (clientNameById.get(b.orders.client_id) ?? null) : null,
      po_number: b.orders?.po_number ?? "—",
      batch_number: b.batch_number,
      status: b.status,
      order_date: b.orders?.date_po ?? null,
      parts: partsByBatch.get(b.id) ?? [],
    }))
    .sort(
      (a, b) =>
        (Number(a.po_number) || 0) - (Number(b.po_number) || 0) ||
        a.batch_number.localeCompare(b.batch_number, undefined, { numeric: true })
    );

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

  /** Valor específico da etapa, já resolvido em texto (só as herdadas do PL). */
  function detailOf(s: StepRow): string | null {
    switch (s.step) {
      case "consolidation_point":
        return s.consolidation_point_id
          ? (factoryNameById.get(s.consolidation_point_id) ?? null)
          : null;
      case "city":
        return s.city_id ? (cityNameById.get(s.city_id) ?? null) : null;
      case "port_of_loading":
        return s.pol_id ? (polNameById.get(s.pol_id) ?? null) : null;
      case "booking":
        return s.booking_number;
      case "agents": {
        const parts = [
          s.carrier_id && `Carrier: ${carrierNameById.get(s.carrier_id) ?? "—"}`,
          s.agent_brazil_id && `Brazil: ${agentNameById.get(s.agent_brazil_id) ?? "—"}`,
          s.contact_brazil_id && `(${contactNameById.get(s.contact_brazil_id) ?? "—"})`,
          s.agent_china_id && `China: ${agentNameById.get(s.agent_china_id) ?? "—"}`,
          s.contact_china_id && `(${contactNameById.get(s.contact_china_id) ?? "—"})`,
          // "Additional infos" da etapa (coluna `notes` do checklist do PL).
          s.notes?.trim() && s.notes.trim(),
        ].filter(Boolean);
        return parts.length ? parts.join(" · ") : null;
      }
      default:
        return null;
    }
  }

  const byStep = new Map(stepRows.map((s) => [s.step, s]));
  const steps: ShipmentStepRow[] = STEP_ORDER.map((step) => {
    const s = byStep.get(step);
    if (!s) {
      const empty = plStepFacts({ completed_on: null }, 0);
      return {
        step,
        done: false,
        gated: hasExtraRequirements(step, empty),
        missing: missingLabel(step, empty) ?? null,
        attachments: [],
        estimated_date: null,
        responsible: null,
        responsible_id: null,
        completed_on: null,
        signed_by: null,
        notes: null,
        detail: null,
      };
    }
    const attachments = attachmentsByStepId.get(s.id) ?? [];
    // Mesma regra das outras duas telas (ver lib/checklist-completion). Resolvida
    // aqui porque a tela só recebe os valores da etapa já virados em texto.
    const facts = plStepFacts(s, attachments.length, contactCountByAgent);
    return {
      step,
      done: isStepChecked(step, facts),
      gated: hasExtraRequirements(step, facts),
      missing: missingLabel(step, facts) ?? null,
      attachments,
      estimated_date: s.estimated_date,
      responsible: s.responsible_id ? (profileNameById.get(s.responsible_id) ?? null) : null,
      responsible_id: s.responsible_id,
      completed_on: s.completed_on,
      signed_by: s.signed_by_id ? (profileNameById.get(s.signed_by_id) ?? null) : null,
      notes: s.notes,
      detail: detailOf(s),
    };
  });

  const stepByKey = new Map(steps.map((s) => [s.step, s]));
  const dates = {
    loading:
      stepByKey.get("loading_date")?.completed_on ??
      stepByKey.get("loading_date")?.estimated_date ??
      null,
    shipment:
      stepByKey.get("shipping_date")?.completed_on ??
      stepByKey.get("shipping_date")?.estimated_date ??
      null,
    eta:
      stepByKey.get("eta_brazil")?.completed_on ??
      stepByKey.get("eta_brazil")?.estimated_date ??
      null,
    delivery: stepByKey.get("delivered")?.completed_on ?? null,
  };

  const profiles: Ref[] = profileRes
    .filter((p) => p.full_name)
    .map((p) => ({ id: p.id, name: p.full_name as string }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Cadastro de fábricas — o modal de ETD usa no campo "Dispatch location".
  const factories: Ref[] = factoryRes
    .map((f) => ({ id: f.id, name: f.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <ShipmentDetailClient
      shipment={{
        id: shipment.id,
        pre_loading_id: pl.id,
        pl_number: pl.pl_number,
        created_date: pl.created_date,
        client_reference: pl.client_reference,
        clients,
        pod: podRes.data?.name ?? null,
        ship_model: modelRes.data?.name ?? null,
        carrier: shipment.carrier_id ? (carrierNameById.get(shipment.carrier_id) ?? null) : null,
        container_number: shipment.container_number,
        leader: shipment.leader_id ? (profileNameById.get(shipment.leader_id) ?? null) : null,
        signer: shipment.signer_id ? (profileNameById.get(shipment.signer_id) ?? null) : null,
        status: STATUS_LABELS[shipment.status] ?? shipment.status,
      }}
      batches={batches}
      steps={steps}
      profiles={profiles}
      factories={factories}
      dates={dates}
      // Entregue não se desfaz (a action recusa igual): o botão some.
      canDelete={permissions.shipments.delete && shipment.status !== "delivered"}
      canEditInherited={isAdmin || isOwner}
      viewPrefs={readViewPrefs(profile.ui_preferences)}
      currentUserId={userId}
    />
  );
}
