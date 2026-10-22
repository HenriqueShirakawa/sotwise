import { notFound } from "next/navigation";

import { TRIGGER_COMPLETED_STEPS } from "@/lib/checklist-completion";
import { summarizeRevisionsByStep } from "@/lib/checklist-revisions";
import { requireFeature } from "@/lib/dal";
import { fetchAll } from "@/lib/fetch-all";
import { isUuid } from "@/lib/slugs";
import { readViewPrefs } from "@/lib/view-prefs";
import { displayBu } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ChecklistStep, LoadingStatus } from "@/types/database";

import {
  OrderDetailClient,
  type BatchRow,
  type ChecklistStepRow,
  type EtdInfoRow,
  type OfcRow,
} from "./order-detail-client";

// Ordem exata do Bubble — só os passos da fase "order" (pre-loading/shipment
// têm suas próprias telas). Packing Confirm. fica de fora: oculta do front
// (HIDDEN_STEPS em lib/checklist, 20/10/2026).
const STEP_ORDER: ChecklistStep[] = [
  "order",
  "po",
  "pi",
  "deposit_payment",
  "condition_confirm",
  "place_the_order",
  "etd",
  "balance_payment",
  "pre_loading",
];

export const metadata = { title: "Order" };

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { profile, userId } = await requireFeature("orders");
  const { id } = await params;
  const admin = createAdminClient();

  // URL aceita o número do pedido (link novo, ex. "1601") OU o UUID interno
  // (link antigo, já mandado por e-mail) — ver docs/regras_de_negocio.md.
  const orderQuery = admin
    .from("orders")
    .select(
      "id, po_number, order_type_id, business_unit_id, client_id, client_reference, requester_id, exporter_id, leader_id, operational_responsible_id, status, schedule_requested, date_po, order_received_date, pi_status, pi_status_date, deposit_date, balance_date"
    )
    .is("deleted_at", null);
  const { data: order } = await (isUuid(id) ? orderQuery.eq("id", id) : orderQuery.eq("po_number", id)).single();

  if (!order) notFound();

  const [
    buRes,
    typeRes,
    clientRes,
    exporterRes,
    profileRes,
    batchesRes,
    stepsRes,
    ofcRes,
    categoriesRes,
    factoriesRes,
  ] = await Promise.all([
    order.business_unit_id
      ? admin.from("business_units").select("name").eq("id", order.business_unit_id).single()
      : Promise.resolve({ data: null }),
    order.order_type_id
      ? admin.from("order_types").select("name").eq("id", order.order_type_id).single()
      : Promise.resolve({ data: null }),
    order.client_id
      ? admin.from("clients").select("name").eq("id", order.client_id).single()
      : Promise.resolve({ data: null }),
    order.exporter_id
      ? admin.from("exporters").select("name, acronym").eq("id", order.exporter_id).single()
      : Promise.resolve({ data: null }),
    // Cadastros e vínculos que alimentam os seletores: paginados para nenhum
    // ficar cortado no teto de 1000 do PostgREST (ver lib/fetch-all).
    fetchAll<{ id: string; full_name: string | null }>((from, to) =>
      admin.from("profiles").select("id, full_name").range(from, to)
    ),
    admin
      .from("batches")
      .select("id, batch_number, status, split_from_batch_id")
      .eq("order_id", order.id)
      .order("batch_number"),
    admin
      .from("order_checklist_steps")
      .select(
        "id, step, enabled, done, estimated_date, responsible_id, completed_on, signed_by_id"
      )
      .eq("order_id", order.id),
    admin
      .from("order_factory_category")
      .select("id, batch_id, category_id, factory_id, ship_requirement, loading_status")
      .eq("is_active", true)
      .eq("order_id", order.id),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin
        .from("categories")
        .select("id, name")
        .is("deleted_at", null)
        .neq("name", "")
        .order("name")
        .range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin
        .from("factories")
        .select("id, name")
        .is("deleted_at", null)
        .neq("name", "")
        .order("name")
        .range(from, to)
    ),
  ]);

  // Ordenado por nome como nas demais telas — a tabela devolve na ordem de
  // inserção, e o seletor de Responsible saía embaralhado.
  const profiles = profileRes
    .filter((p) => p.full_name)
    .map((p) => ({ id: p.id, name: p.full_name as string }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const profileMap = new Map(profiles.map((p) => [p.id, p.name]));
  const categoryMap = new Map(categoriesRes.map((c) => [c.id, c.name]));
  const factoryMap = new Map(factoriesRes.map((f) => [f.id, f.name]));

  const stepRows = stepsRes.data ?? [];
  const stepIds = stepRows.map((s) => s.id);
  const attachmentsRes = stepIds.length
    ? await admin
        .from("step_attachments")
        .select("id, checklist_step_id, factory_id, file_name, file_path, created_at")
        .in("checklist_step_id", stepIds)
    : { data: [] };
  const attachmentsByStep = new Map<string, ChecklistStepRow["attachments"]>();
  for (const a of attachmentsRes.data ?? []) {
    // checklist_step_id é nullable desde que a tabela passou a servir também
    // às etapas de Pre-loading — aqui o filtro `.in()` já garante que veio.
    if (!a.checklist_step_id) continue;
    const arr = attachmentsByStep.get(a.checklist_step_id) ?? [];
    arr.push({
      id: a.id,
      factory_id: a.factory_id,
      file_name: a.file_name,
      file_path: a.file_path,
      created_at: a.created_at,
    });
    attachmentsByStep.set(a.checklist_step_id, arr);
  }

  const stepByKey = new Map(stepRows.map((s) => [s.step, s]));
  // Badge de revisões das etapas Order/PO/PI (lib/checklist-revisions).
  const revisions = await summarizeRevisionsByStep(
    admin,
    stepRows.filter((s) => TRIGGER_COMPLETED_STEPS.has(s.step)).map((s) => s.id)
  );

  const steps: ChecklistStepRow[] = STEP_ORDER.filter((key) => stepByKey.has(key)).map(
    (key) => {
      const s = stepByKey.get(key)!;
      return {
        id: s.id,
        step: s.step,
        enabled: s.enabled,
        done: s.done,
        estimated_date: s.estimated_date,
        completed_on: s.completed_on,
        responsible_id: s.responsible_id,
        signed_by_id: s.signed_by_id,
        attachments: attachmentsByStep.get(s.id) ?? [],
        revision_count: revisions[s.id]?.count ?? 0,
        revision_original_date: revisions[s.id]?.originalDate ?? null,
      };
    }
  );

  const requesterName = order.requester_id
    ? profileMap.get(order.requester_id) ?? null
    : null;
  const leaderName = order.leader_id ? profileMap.get(order.leader_id) ?? null : null;
  const operationalResponsibleName = order.operational_responsible_id
    ? profileMap.get(order.operational_responsible_id) ?? null
    : null;

  const ofc: OfcRow[] = (ofcRes.data ?? []).map((o) => ({
    id: o.id,
    batch_id: o.batch_id,
    category_id: o.category_id,
    category_name: categoryMap.get(o.category_id) ?? "—",
    factory_id: o.factory_id,
    factory_name: factoryMap.get(o.factory_id) ?? "—",
    ship_requirement: o.ship_requirement,
    loading_status: o.loading_status,
  }));

  // O que cada lote embarcou, por entrada — congelado no Confirm Shipping
  // (tabela shipment_loaded_lines). É o que o "View batch" mostra na coluna
  // Status: a entrada marcada Partial migra para o lote-filho do split e perde
  // o loading_status atual, mas o embarque que a carregou continua registrado.
  const batchIds = (batchesRes.data ?? []).map((b) => b.id);
  // Place the Order: data "Placed on" de cada fábrica (22/10/2026).
  const { data: placedRows } = await admin
    .from("order_factory_placed_dates")
    .select("factory_id, placed_on")
    .eq("order_id", order.id);
  const placedDates = Object.fromEntries(
    (placedRows ?? []).map((r) => [r.factory_id, r.placed_on])
  );
  const [loadedRes, plLinksRes] = batchIds.length
    ? await Promise.all([
        admin
          .from("shipment_loaded_lines")
          .select("batch_id, order_factory_category_id, loading_status")
          .in("batch_id", batchIds),
        // PL de cada lote — etapa Pre-Loading (22/10/2026): referência + data de
        // criação do PL, com link pra ele.
        admin
          .from("pre_loading_batches")
          .select("batch_id, pre_loadings(id, pl_number, created_date, deleted_at)")
          .in("batch_id", batchIds)
          .returns<
            {
              batch_id: string;
              pre_loadings: {
                id: string;
                pl_number: string;
                created_date: string;
                deleted_at: string | null;
              } | null;
            }[]
          >(),
      ])
    : [{ data: [] }, { data: [] }];
  const plByBatch = new Map<string, NonNullable<BatchRow["pl"]>>();
  for (const l of plLinksRes.data ?? []) {
    const pl = l.pre_loadings;
    if (pl && !pl.deleted_at) {
      plByBatch.set(l.batch_id, {
        id: pl.id,
        pl_number: pl.pl_number,
        created_date: pl.created_date,
      });
    }
  }
  const loadedByBatch: Record<string, Record<string, LoadingStatus>> = {};
  for (const l of loadedRes.data ?? []) {
    (loadedByBatch[l.batch_id] ??= {})[l.order_factory_category_id] = l.loading_status;
  }

  const ofcIds = ofc.map((o) => o.id);
  const etdRes = ofcIds.length
    ? await admin
        .from("etd_info")
        .select(
          "order_factory_category_id, inspection, ready, ready_date, initial_date, current_date, dispatch_location_id, dispatch_date, remarks"
        )
        .in("order_factory_category_id", ofcIds)
    : { data: [] };
  const etdByOfc: Record<string, EtdInfoRow> = {};
  for (const e of etdRes.data ?? []) {
    etdByOfc[e.order_factory_category_id] = {
      inspection: e.inspection,
      ready: e.ready,
      ready_date: e.ready_date,
      initial_date: e.initial_date,
      current_date: e.current_date,
      dispatch_location_id: e.dispatch_location_id,
      dispatch_date: e.dispatch_date,
      remarks: e.remarks,
    };
  }

  return (
    <OrderDetailClient
      orderId={order.id}
      order={{
        po_number: order.po_number,
        bu: buRes.data?.name ? displayBu(buRes.data.name) : null,
        type: typeRes.data?.name ?? null,
        client: clientRes.data?.name ?? null,
        client_reference: order.client_reference,
        requester: requesterName,
        leader: leaderName,
        operational_responsible: operationalResponsibleName,
        exporter: exporterRes.data ? exporterRes.data.acronym || exporterRes.data.name : null,
        date_po: order.date_po,
        order_received_date: order.order_received_date,
        pi_status: order.pi_status,
        pi_status_date: order.pi_status_date,
        deposit_date: order.deposit_date,
        balance_date: order.balance_date,
        status: order.status,
        schedule_requested: order.schedule_requested,
      }}
      batches={(batchesRes.data ?? []).map((b) => ({
        id: b.id,
        batch_number: b.batch_number,
        status: b.status,
        split_from_batch_id: b.split_from_batch_id,
        pl: plByBatch.get(b.id) ?? null,
      }))}
      ofc={ofc}
      etdByOfc={etdByOfc}
      loadedByBatch={loadedByBatch}
      factories={factoriesRes.map((f) => ({ id: f.id, name: f.name }))}
      profiles={profiles}
      steps={steps}
      viewPrefs={readViewPrefs(profile.ui_preferences)}
      currentUserId={userId}
      placedDates={placedDates}
    />
  );
}
