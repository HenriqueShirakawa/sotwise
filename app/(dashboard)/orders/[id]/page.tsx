import { notFound } from "next/navigation";

import { verifySession } from "@/lib/dal";
import { displayBu } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ChecklistStep } from "@/types/database";

import { OrderDetailClient, type ChecklistStepRow } from "./order-detail-client";

// Ordem/curadoria igual à tela "Order progress" do Bubble — só os passos da
// fase "order" (pre-loading/shipment têm suas próprias telas).
const STEP_ORDER: ChecklistStep[] = [
  "order",
  "packing_confirm",
  "po",
  "condition_confirm",
  "pi",
  "place_the_order",
  "deposit_payment",
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

  const [buRes, typeRes, clientRes, exporterRes, profileRes, batchesRes, stepsRes] =
    await Promise.all([
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
        .select("batch_number, status")
        .eq("order_id", order.id)
        .order("batch_number"),
      admin
        .from("order_checklist_steps")
        .select(
          "id, step, enabled, done, estimated_date, responsible_id, completed_on, signed_by_id"
        )
        .eq("order_id", order.id),
    ]);

  const profileMap = new Map(
    (profileRes.data ?? []).map((p) => [p.id, p.full_name])
  );

  const stepByKey = new Map(
    (stepsRes.data ?? []).map((s) => [s.step, s])
  );

  const steps: ChecklistStepRow[] = STEP_ORDER.filter((key) => stepByKey.has(key)).map(
    (key) => {
      const s = stepByKey.get(key)!;
      return {
        step: s.step,
        enabled: s.enabled,
        done: s.done,
        estimated_date: s.estimated_date,
        completed_on: s.completed_on,
        responsible: s.responsible_id ? profileMap.get(s.responsible_id) ?? null : null,
        signed_by: s.signed_by_id ? profileMap.get(s.signed_by_id) ?? null : null,
      };
    }
  );

  const requesterName = order.requester_id
    ? profileMap.get(order.requester_id) ?? null
    : null;
  const leaderName = order.leader_id ? profileMap.get(order.leader_id) ?? null : null;

  return (
    <OrderDetailClient
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
        batch_number: b.batch_number,
        status: b.status,
      }))}
      steps={steps}
    />
  );
}
