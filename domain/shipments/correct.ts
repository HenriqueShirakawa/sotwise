import { writeStepLog } from "@/lib/checklist-step-log";
import { syncOrderPreLoadingStep } from "@/lib/checklist-revisions";
import { fetchAll } from "@/lib/fetch-all";
import { syncOrderStatusForBatches } from "@/lib/order-status";
import { autoCompletePlStep } from "@/lib/pl-step-autocomplete";
import type { createAdminClient } from "@/lib/supabase/admin";
import { userTodayIso } from "@/lib/user-time-zone";
import type { BatchStatus, ChecklistStep } from "@/types/database";

import {
  addBatchError,
  HEADER_LOG_KEY,
  planShipmentCorrection,
  SHIPMENT_HEADER_FIELDS,
  type AddableBatchFacts,
  type CurrentShipmentState,
  type ShipmentCorrectionInput,
  type ShipmentHeaderValues,
} from "./correction";

/**
 * Gravação do "Correct shipment" (19/11/2026) — a regra (sem banco) está em
 * ./correction.ts. Sem RPC/migration de propósito: a validação inteira roda
 * antes da primeira escrita, e as escritas vão na ordem em que uma falha no
 * meio deixa o menor estrago (lotes primeiro, cabeçalho depois, History por
 * último). Os efeitos em cascata (status das Orders, etapa Pre-Loading da
 * Order, etapas por cliente) usam os mesmos helpers do Edit PL
 * (domain/pre-loadings/write.ts).
 */

type Admin = ReturnType<typeof createAdminClient>;

/** Mesmas etapas por cliente que o Edit PL recheca ao trocar lotes. */
const PER_CLIENT_RECHECK_STEPS: ChecklistStep[] = ["shipping_docs", "bl", "original_docs"];

type BatchRow = {
  id: string;
  batch_number: string;
  status: BatchStatus;
  is_active: boolean;
  quantities_confirmed: boolean;
  order_id: string;
  orders: { po_number: string; client_id: string | null; deleted_at: string | null } | null;
};

const BATCH_SELECT =
  "id, batch_number, status, is_active, quantities_confirmed, order_id, orders(po_number, client_id, deleted_at)";

const batchLabel = (b: Pick<BatchRow, "batch_number" | "orders">) =>
  `${b.orders?.po_number ?? ""}${b.batch_number}`;

export type CorrectionBatch = { id: string; label: string; client: string | null; status: BatchStatus };

export type ShipmentCorrectionState = {
  shipment_id: string;
  pre_loading_id: string;
  pl_number: string;
  status: string;
  header: Record<keyof ShipmentHeaderValues, string | null>;
  batches: CorrectionBatch[];
};

/** Estado atual do embarque, como o popup do Confirm deixou. */
export async function loadShipmentCorrectionState(
  admin: Admin,
  shipmentId: string
): Promise<{ ok: true; state: ShipmentCorrectionState } | { ok: false; error: string }> {
  const { data: shipment, error: shipmentError } = await admin
    .from("shipments")
    .select("id, pre_loading_id, status, container_number, carrier_id, shipment_model_id, leader_id, signer_id")
    .eq("id", shipmentId)
    .is("deleted_at", null)
    .maybeSingle();
  if (shipmentError) return { ok: false, error: shipmentError.message };
  if (!shipment) return { ok: false, error: "Shipment not found." };

  const [plRes, stepRes, linkRes] = await Promise.all([
    admin
      .from("pre_loadings")
      .select("id, pl_number, seal_number, leader_id")
      .eq("id", shipment.pre_loading_id)
      .maybeSingle(),
    admin
      .from("pre_loading_checklist_steps")
      .select("event_date")
      .eq("pre_loading_id", shipment.pre_loading_id)
      .eq("step", "loading_date")
      .maybeSingle(),
    admin.from("pre_loading_batches").select("batch_id").eq("pre_loading_id", shipment.pre_loading_id),
  ]);
  if (plRes.error || !plRes.data) return { ok: false, error: plRes.error?.message ?? "Pre-loading not found." };
  if (linkRes.error) return { ok: false, error: linkRes.error.message };

  const batchIds = (linkRes.data ?? []).map((l) => l.batch_id);
  const { data: batchRows, error: batchError } = batchIds.length
    ? await admin.from("batches").select(BATCH_SELECT).in("id", batchIds).returns<BatchRow[]>()
    : { data: [] as BatchRow[], error: null };
  if (batchError) return { ok: false, error: batchError.message };

  const clientName = await clientNames(admin, batchRows ?? []);
  const batches = (batchRows ?? [])
    .map((b) => ({
      id: b.id,
      label: batchLabel(b),
      client: b.orders?.client_id ? (clientName.get(b.orders.client_id) ?? null) : null,
      status: b.status,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

  return {
    ok: true,
    state: {
      shipment_id: shipment.id,
      pre_loading_id: shipment.pre_loading_id,
      pl_number: plRes.data.pl_number,
      status: shipment.status,
      header: {
        container_number: shipment.container_number,
        seal_number: plRes.data.seal_number,
        loading_date: stepRes.data?.event_date ?? null,
        shipment_leader_id: shipment.leader_id,
        preloading_leader_id: plRes.data.leader_id,
        carrier_id: shipment.carrier_id,
        shipment_model_id: shipment.shipment_model_id,
        signer_id: shipment.signer_id,
      },
      batches,
    },
  };
}

/**
 * Lotes que a correção pode pôr no embarque: In Production, ativos, livres de
 * PL vivo e com as quantidades já confirmadas pelo GSS (régua do Confirm).
 */
export async function loadAddableBatches(admin: Admin): Promise<CorrectionBatch[]> {
  const rows = await fetchAll<BatchRow>((from, to) =>
    admin
      .from("batches")
      .select(BATCH_SELECT)
      .eq("status", "in_production")
      .eq("is_active", true)
      .eq("quantities_confirmed", true)
      .range(from, to)
      .returns<BatchRow[]>()
  );
  const live = rows.filter((b) => b.orders && !b.orders.deleted_at);
  const taken = await livePlNumberByBatch(admin, live.map((b) => b.id));
  const free = live.filter((b) => !taken.has(b.id));
  const clientName = await clientNames(admin, free);
  return free
    .map((b) => ({
      id: b.id,
      label: batchLabel(b),
      client: b.orders?.client_id ? (clientName.get(b.orders.client_id) ?? null) : null,
      status: b.status,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

export type CorrectShipmentResult =
  | { ok: true; pre_loading_id: string; removed_batch_ids: string[]; batches_changed: boolean }
  | { ok: false; error: string };

export async function correctShipmentRecord(
  admin: Admin,
  shipmentId: string,
  input: ShipmentCorrectionInput,
  actorId: string
): Promise<CorrectShipmentResult> {
  const loaded = await loadShipmentCorrectionState(admin, shipmentId);
  if (!loaded.ok) return loaded;
  const state = loaded.state;

  const current: CurrentShipmentState = {
    status: state.status,
    header: state.header,
    batches: state.batches.map((b) => ({ id: b.id, status: b.status, label: b.label })),
  };
  const planned = planShipmentCorrection(current, input, await userTodayIso());
  if (!planned.ok) return planned;
  const { header, added, removed, reason } = planned.plan;

  // Lotes que entram: revalida no servidor (a lista do modal pode estar velha).
  let addedRows: BatchRow[] = [];
  if (added.length > 0) {
    const { data, error } = await admin
      .from("batches")
      .select(BATCH_SELECT)
      .in("id", added)
      .returns<BatchRow[]>();
    if (error) return { ok: false, error: error.message };
    addedRows = data ?? [];
    const taken = await livePlNumberByBatch(admin, added);
    const byId = new Map(addedRows.map((b) => [b.id, b]));
    for (const id of added) {
      const b = byId.get(id);
      const facts: AddableBatchFacts | undefined =
        b && b.orders && !b.orders.deleted_at
          ? {
              label: batchLabel(b),
              status: b.status,
              is_active: b.is_active,
              quantities_confirmed: b.quantities_confirmed,
              pl_number: taken.get(id) ?? null,
            }
          : undefined;
      const error = addBatchError(facts);
      if (error) return { ok: false, error };
    }
  }

  const plId = state.pre_loading_id;
  const labelById = new Map([
    ...state.batches.map((b) => [b.id, b.label] as const),
    ...addedRows.map((b) => [b.id, batchLabel(b)] as const),
  ]);

  // 1. Lotes. O que sai volta a In Production (o gatilho zera quantities_confirmed);
  // o que entra vai direto a In Transit — nunca passa por Pre-loading, senão o
  // gatilho zeraria a confirmação do GSS que acabou de ser exigida.
  if (removed.length > 0) {
    const del = await admin
      .from("pre_loading_batches")
      .delete()
      .eq("pre_loading_id", plId)
      .in("batch_id", removed);
    if (del.error) return { ok: false, error: del.error.message };
    const back = await admin.from("batches").update({ status: "in_production" }).in("id", removed);
    if (back.error) return { ok: false, error: back.error.message };
  }
  if (added.length > 0) {
    const ins = await admin
      .from("pre_loading_batches")
      .insert(added.map((batch_id) => ({ pre_loading_id: plId, batch_id })));
    if (ins.error) return { ok: false, error: ins.error.message };
    const fwd = await admin.from("batches").update({ status: "in_transit" }).in("id", added);
    if (fwd.error) return { ok: false, error: fwd.error.message };
  }
  const batchesChanged = added.length > 0 || removed.length > 0;
  let clientsChanged = false;
  if (batchesChanged) {
    const synced = await syncPlClientsFromBatches(admin, plId);
    if ("error" in synced) return { ok: false, error: synced.error };
    clientsChanged = synced.changed;
  }

  // 2. Cabeçalho: Shipment, PL e a data real da Loading Date.
  const shipmentPatch: Partial<
    Record<"container_number" | "carrier_id" | "shipment_model_id" | "leader_id" | "signer_id", string>
  > = {};
  if (header.container_number) shipmentPatch.container_number = header.container_number.to;
  if (header.carrier_id) shipmentPatch.carrier_id = header.carrier_id.to;
  if (header.shipment_model_id) shipmentPatch.shipment_model_id = header.shipment_model_id.to;
  if (header.shipment_leader_id) shipmentPatch.leader_id = header.shipment_leader_id.to;
  if (header.signer_id) shipmentPatch.signer_id = header.signer_id.to;
  if (Object.keys(shipmentPatch).length > 0) {
    const { error } = await admin.from("shipments").update(shipmentPatch).eq("id", shipmentId);
    if (error) return { ok: false, error: error.message };
  }

  const plPatch: Partial<Record<"seal_number" | "leader_id", string>> = {};
  if (header.seal_number) plPatch.seal_number = header.seal_number.to;
  if (header.preloading_leader_id) plPatch.leader_id = header.preloading_leader_id.to;
  if (Object.keys(plPatch).length > 0) {
    const { error } = await admin.from("pre_loadings").update(plPatch).eq("id", plId);
    if (error) return { ok: false, error: error.message };
  }

  // Loading Date: só a data real (event_date). O Completed on segue sendo o dia
  // do Confirm — é a correção que fica registrada, com motivo, no History.
  const { data: loadingStep, error: stepError } = await admin
    .from("pre_loading_checklist_steps")
    .select("id")
    .eq("pre_loading_id", plId)
    .eq("step", "loading_date")
    .maybeSingle();
  if (stepError) return { ok: false, error: stepError.message };
  if (header.loading_date) {
    const { error } = loadingStep
      ? await admin
          .from("pre_loading_checklist_steps")
          .update({ event_date: header.loading_date.to })
          .eq("id", loadingStep.id)
      : await admin
          .from("pre_loading_checklist_steps")
          .insert({ pre_loading_id: plId, step: "loading_date", event_date: header.loading_date.to });
    if (error) return { ok: false, error: error.message };
  }

  // 3. History da etapa Loading Date (a do Confirm): tudo numa entrada, com motivo.
  const stepId =
    loadingStep?.id ??
    (
      await admin
        .from("pre_loading_checklist_steps")
        .select("id")
        .eq("pre_loading_id", plId)
        .eq("step", "loading_date")
        .maybeSingle()
    ).data?.id;
  if (stepId) {
    const changes: Record<string, unknown> = {};
    for (const f of SHIPMENT_HEADER_FIELDS) {
      const diff = header[f];
      if (diff) changes[HEADER_LOG_KEY[f]] = diff;
    }
    const labels = (ids: string[]) =>
      ids
        .map((id) => labelById.get(id) ?? id)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .join(", ");
    if (removed.length > 0) changes.batches_removed = { from: null, to: labels(removed) };
    if (added.length > 0) changes.batches_added = { from: null, to: labels(added) };
    changes.reason = reason;
    await writeStepLog(admin, {
      owner: { preLoadingStepId: stepId },
      step: "loading_date",
      action: "update",
      changes,
      userId: actorId,
    });
  }

  // 4. Cascata dos lotes, igual ao Edit PL: etapa Pre-Loading da Order, status
  // das Orders (rollup + webhook ao GSS) e as etapas por cliente.
  if (batchesChanged) {
    const touched = [...added, ...removed];
    const { data: touchedBatches } = await admin.from("batches").select("order_id").in("id", touched);
    await syncOrderPreLoadingStep(
      admin,
      (touchedBatches ?? []).map((b) => b.order_id),
      actorId
    );
    const statusError = await syncOrderStatusForBatches(admin, touched, actorId);
    if (statusError) return { ok: false, error: statusError };
    // Só quando o conjunto de CLIENTES mudou (cliente novo sem documento reabre
    // a etapa dele). Trocar lote do mesmo cliente não recheca: em embarque
    // legado do Bubble o recheck reabria Shipping Docs/BL já concluídos
    // (teste de 19/11/2026 no PL 1208).
    if (clientsChanged) {
      for (const step of PER_CLIENT_RECHECK_STEPS) {
        await autoCompletePlStep(admin, plId, step, actorId, { recheck: true });
      }
    }
  }

  return { ok: true, pre_loading_id: plId, removed_batch_ids: removed, batches_changed: batchesChanged };
}

/** Nº do PL vivo de cada lote que já está em algum (PL excluído libera o lote). */
async function livePlNumberByBatch(admin: Admin, batchIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (batchIds.length === 0) return out;
  const { data } = await admin
    .from("pre_loading_batches")
    .select("batch_id, pre_loadings!inner(pl_number, deleted_at)")
    .in("batch_id", batchIds)
    .is("pre_loadings.deleted_at", null)
    .returns<{ batch_id: string; pre_loadings: { pl_number: string } | null }[]>();
  for (const row of data ?? []) {
    if (row.pre_loadings) out.set(row.batch_id, row.pre_loadings.pl_number);
  }
  return out;
}

async function clientNames(admin: Admin, rows: BatchRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((b) => b.orders?.client_id).filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const { data } = await admin.from("clients").select("id, name").in("id", ids);
  return new Map((data ?? []).map((c) => [c.id, c.name]));
}

/**
 * Clientes do PL = clientes das Orders dos lotes (regra do Create PL,
 * 09/11/2026). Só regrava quando o conjunto muda; `changed` diz se mudou.
 */
async function syncPlClientsFromBatches(
  admin: Admin,
  plId: string
): Promise<{ changed: boolean } | { error: string }> {
  const [linkRes, currentRes] = await Promise.all([
    admin
      .from("pre_loading_batches")
      .select("batches(orders(client_id))")
      .eq("pre_loading_id", plId)
      .returns<{ batches: { orders: { client_id: string | null } | null } | null }[]>(),
    admin.from("pre_loading_clients").select("client_id").eq("pre_loading_id", plId),
  ]);
  if (linkRes.error) return { error: linkRes.error.message };
  if (currentRes.error) return { error: currentRes.error.message };
  const clientIds = [
    ...new Set(
      (linkRes.data ?? [])
        .map((l) => l.batches?.orders?.client_id)
        .filter((id): id is string => !!id)
    ),
  ];
  const before = new Set((currentRes.data ?? []).map((c) => c.client_id));
  const same = before.size === clientIds.length && clientIds.every((id) => before.has(id));
  if (same) return { changed: false };

  const del = await admin.from("pre_loading_clients").delete().eq("pre_loading_id", plId);
  if (del.error) return { error: del.error.message };
  if (clientIds.length > 0) {
    const ins = await admin
      .from("pre_loading_clients")
      .insert(clientIds.map((client_id) => ({ pre_loading_id: plId, client_id })));
    if (ins.error) return { error: ins.error.message };
  }
  return { changed: true };
}
