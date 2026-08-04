import { notFound } from "next/navigation";

import { verifySession } from "@/lib/dal";
import { displayBu } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ChecklistStep } from "@/types/database";

import {
  OrderDetailClient,
  type ChecklistStepRow,
  type EtdInfoRow,
  type OfcRow,
} from "./order-detail-client";

// Ordem exata do Bubble — só os passos da fase "order" (pre-loading/shipment
// têm suas próprias telas).
const STEP_ORDER: ChecklistStep[] = [
  "order",
  "po",
  "pi",
  "deposit_payment",
  "packing_confirm",
  "condition_confirm",
  "place_the_order",
  "etd",
  "balance_payment",
  "pre_loading",
];

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await verifySession();
  const { id } = await params;
  const admin = createAdminClient();

  const { data: order } = await admin
    .from("orders")
    .select(
      "id, po_number, order_type_id, business_unit_id, client_id, client_reference, requester_id, exporter_id, leader_id, status, schedule_requested, date_po"
    )
    .eq("id", id)
    .is("deleted_at", null)
    .single();

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
    categoryFactoriesRes,
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
    admin.from("profiles").select("id, full_name"),
    admin
      .from("batches")
      .select("id, batch_number, status")
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
      .eq("order_id", order.id),
    admin
      .from("categories")
      .select("id, name")
      .is("deleted_at", null)
      .neq("name", "")
      .order("name"),
    admin
      .from("factories")
      .select("id, name")
      .is("deleted_at", null)
      .neq("name", "")
      .order("name"),
    // Vínculo Factory × Category (docs §3.5.2) — o seletor de Factory dos
    // modais de lote só oferece as fábricas da categoria escolhida.
    admin.from("category_factories").select("category_id, factory_id"),
  ]);

  const profiles = (profileRes.data ?? [])
    .filter((p) => p.full_name)
    .map((p) => ({ id: p.id, name: p.full_name as string }));
  const profileMap = new Map(profiles.map((p) => [p.id, p.name]));
  const categoryMap = new Map((categoriesRes.data ?? []).map((c) => [c.id, c.name]));
  const factoryMap = new Map((factoriesRes.data ?? []).map((f) => [f.id, f.name]));

  const stepRows = stepsRes.data ?? [];
  const stepIds = stepRows.map((s) => s.id);
  const attachmentsRes = stepIds.length
    ? await admin
        .from("step_attachments")
        .select("id, checklist_step_id, factory_id, file_name, file_path")
        .in("checklist_step_id", stepIds)
    : { data: [] };
  const attachmentsByStep = new Map<
    string,
    { id: string; factory_id: string | null; file_name: string | null; file_path: string }[]
  >();
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
    });
    attachmentsByStep.set(a.checklist_step_id, arr);
  }

  const stepByKey = new Map(stepRows.map((s) => [s.step, s]));

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
      };
    }
  );

  const requesterName = order.requester_id
    ? profileMap.get(order.requester_id) ?? null
    : null;
  const leaderName = order.leader_id ? profileMap.get(order.leader_id) ?? null : null;

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

  // category_id → fábricas vinculadas. Categoria sem vínculo não entra no mapa;
  // o client trata a ausência como "sem restrição" (ver order-detail-client).
  const factoriesByCategory: Record<string, string[]> = {};
  for (const link of categoryFactoriesRes.data ?? []) {
    (factoriesByCategory[link.category_id] ??= []).push(link.factory_id);
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
        exporter: exporterRes.data ? exporterRes.data.acronym || exporterRes.data.name : null,
        date_po: order.date_po,
        status: order.status,
        schedule_requested: order.schedule_requested,
      }}
      batches={(batchesRes.data ?? []).map((b) => ({
        id: b.id,
        batch_number: b.batch_number,
        status: b.status,
      }))}
      ofc={ofc}
      etdByOfc={etdByOfc}
      categories={(categoriesRes.data ?? []).map((c) => ({ id: c.id, name: c.name }))}
      factories={(factoriesRes.data ?? []).map((f) => ({ id: f.id, name: f.name }))}
      factoriesByCategory={factoriesByCategory}
      profiles={profiles}
      steps={steps}
    />
  );
}
