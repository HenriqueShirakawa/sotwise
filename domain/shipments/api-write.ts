import "server-only";

import { revalidatePath } from "next/cache";

import { scheduleClientNotificationDispatch } from "@/domain/client/notifications";
import { validateStepDates } from "@/lib/checklist-completion";
import { broadcastOrderStatusPing } from "@/lib/orders-realtime";
import { broadcastPreLoadingPing } from "@/lib/preloading-realtime";
import { broadcastShipmentPing } from "@/lib/shipments-realtime";
import type { createAdminClient } from "@/lib/supabase/admin";
import { fail, isUuid, type Fail, type WriteResult } from "@/domain/api/write-result";
import { resolveBatchKey } from "@/domain/batches/api-read";
import { resolveProfileByEmail } from "@/domain/orders/api-write";
import {
  createPreLoadingRecord,
  deletePreLoadingRecord,
  syncPreLoadingRelations,
} from "@/domain/pre-loadings/write";
import { SHIPMENT_STEPS } from "@/lib/checklist";
import type { ChecklistStep, TablesUpdate } from "@/types/database";

import { getShipment, type ShipmentRead } from "./api-read";
import {
  COMMON_STEP_FIELDS,
  PL_CHECKLIST_STEPS,
  STEP_FIELDS,
  type CreateShipmentInput,
  type PatchShipmentInput,
  type PatchStepInput,
} from "./api-schema";
import { confirmShippingRecord } from "./confirm";
import { applyDeliveredRule } from "./delivered";

/**
 * Escrita de PL + SHIPMENT pela API (/api/shipments). Os caminhos são os MESMOS
 * das telas — criação/edição/exclusão do PL (domain/pre-loadings/write.ts),
 * Confirm Shipping (domain/shipments/confirm.ts, RPC confirm_shipping),
 * desfazer embarque (RPC delete_shipment) e a regra do Delivered
 * (domain/shipments/delivered.ts) —, mais as travas que hoje só a tela fazia:
 *
 *  - lote que entra no PL tem de estar In Production, com ≥1 linha e fora de
 *    outro PL (a tela só OFERECE esses no seletor);
 *  - PL já embarcado não muda cabeçalho/lotes nem é apagado (desfaça antes);
 *  - etapas do Shipment (#18–24) só abrem depois do Confirm Shipping.
 *
 * Sem eco: o que chega por aqui NÃO é reenviado ao GSS (quem escreveu foi ele).
 */

type AdminClient = ReturnType<typeof createAdminClient>;
type UUID = string;

type RefTable =
  | "clients"
  | "pods"
  | "carriers"
  | "shipment_models"
  | "factories"
  | "cities"
  | "pols"
  | "agents"
  | "contacts";

/** Referência de biblioteca: UUID do SOTWISE ou `gss_id`. */
async function resolveRef(
  admin: AdminClient,
  table: RefTable,
  ref: string,
  label: string
): Promise<{ ok: true; id: UUID } | Fail> {
  const column = isUuid(ref) ? "id" : "gss_id";
  const { data, error } = await admin
    .from(table)
    .select("id")
    .eq(column, ref)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return fail(column === "gss_id" ? 400 : 500, `${label} '${ref}': ${error.message}`);
  if (!data) return fail(400, `No ${label} found for '${ref}' (send the SOTWISE id or the gss_id).`);
  return { ok: true, id: (data as { id: UUID }).id };
}

async function resolvePerson(
  admin: AdminClient,
  email: string | null | undefined
): Promise<{ ok: true; id: UUID | null } | Fail> {
  const r = await resolveProfileByEmail(admin, email);
  return r.ok ? r : fail(400, r.error);
}

function refreshViews() {
  revalidatePath("/pre-loading/[id]", "page");
  revalidatePath("/pre-loading");
  revalidatePath("/shipments/[id]", "page");
  revalidatePath("/shipments");
  revalidatePath("/orders");
  revalidatePath("/todo");
}

async function readBack(admin: AdminClient, id: UUID, status: 200 | 201): Promise<WriteResult<ShipmentRead>> {
  const row = await getShipment(admin, id);
  if (!row) return fail(500, "Pre-loading was saved but could not be read back.");
  return { ok: true, status, data: row };
}

/**
 * Lotes pedidos para o PL → UUIDs, validados. `currentIds` = lotes que já estão
 * neste PL (podem ficar, qualquer que seja o status).
 */
async function resolvePlBatches(
  admin: AdminClient,
  keys: string[],
  currentIds: Set<UUID>
): Promise<{ ok: true; ids: UUID[] } | Fail> {
  const ids: UUID[] = [];
  for (const key of keys) {
    const id = await resolveBatchKey(admin, key);
    if (!id) return fail(400, `Batch '${key}' not found.`);
    if (!ids.includes(id)) ids.push(id);
  }
  const incoming = ids.filter((id) => !currentIds.has(id));
  if (incoming.length === 0) return { ok: true, ids };

  const { data: batches, error } = await admin
    .from("batches")
    .select("id, batch_number, status, orders(po_number)")
    .in("id", incoming);
  if (error) return fail(500, error.message);
  const { data: links, error: linkError } = await admin
    .from("pre_loading_batches")
    .select("batch_id, pre_loadings(pl_number)")
    .in("batch_id", incoming);
  if (linkError) return fail(500, linkError.message);
  const { data: lines, error: linesError } = await admin
    .from("order_factory_category")
    .select("batch_id")
    .in("batch_id", incoming);
  if (linesError) return fail(500, linesError.message);
  const withLines = new Set((lines ?? []).map((l) => l.batch_id));

  for (const b of batches ?? []) {
    const order = Array.isArray(b.orders) ? b.orders[0] : b.orders;
    const label = `${(order as { po_number?: string } | null)?.po_number ?? ""}${b.batch_number}`;
    const link = (links ?? []).find((l) => l.batch_id === b.id);
    if (link) {
      const pl = Array.isArray(link.pre_loadings) ? link.pre_loadings[0] : link.pre_loadings;
      return fail(409, `Batch ${label} is already in pre-loading ${(pl as { pl_number?: string } | null)?.pl_number ?? "?"}.`);
    }
    if (b.status !== "in_production") {
      return fail(409, `Batch ${label} is '${b.status}' — only batches In Production can enter a pre-loading.`);
    }
    if (!withLines.has(b.id)) {
      return fail(409, `Batch ${label} has no Factory x Category entry.`);
    }
  }
  return { ok: true, ids };
}

export async function createShipment(
  admin: AdminClient,
  actorId: string | null,
  input: CreateShipmentInput
): Promise<WriteResult<ShipmentRead>> {
  // Idempotente por gss_id: reenvio devolve o que já existe (mudanças → PATCH).
  if (input.gss_id) {
    const { data: existing, error } = await admin
      .from("pre_loadings")
      .select("id")
      .eq("gss_id", input.gss_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return fail(500, error.message);
    if (existing) return readBack(admin, existing.id, 200);
  }

  const clientIds: UUID[] = [];
  for (const ref of input.clients) {
    const r = await resolveRef(admin, "clients", ref, "client");
    if (!r.ok) return r;
    if (!clientIds.includes(r.id)) clientIds.push(r.id);
  }
  const pod = await resolveRef(admin, "pods", input.pod, "pod");
  if (!pod.ok) return pod;
  const leader = await resolvePerson(admin, input.leader_email);
  if (!leader.ok) return leader;
  const signer = await resolvePerson(admin, input.responsible_signer_email);
  if (!signer.ok) return signer;
  const batches = await resolvePlBatches(admin, input.batch_ids, new Set());
  if (!batches.ok) return batches;

  const created = await createPreLoadingRecord(admin, {
    client_reference: input.client_reference,
    pod_id: pod.id,
    leader_id: leader.id!,
    responsible_signer_id: signer.id,
    client_ids: clientIds,
    batch_ids: batches.ids,
    created_by: actorId,
    gss_id: input.gss_id ?? null,
  });
  if (!created.ok) return fail(created.conflict ? 409 : 500, created.error);

  refreshViews();
  await broadcastPreLoadingPing();
  return readBack(admin, created.id, 201);
}

type PlState = {
  id: UUID;
  leader_id: UUID | null;
  shipment: { id: UUID; status: string } | null;
};

async function loadPl(admin: AdminClient, id: UUID): Promise<{ ok: true; pl: PlState } | Fail> {
  const { data, error } = await admin
    .from("pre_loadings")
    .select("id, leader_id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(404, "Pre-loading not found.");
  const { data: shipment, error: shipError } = await admin
    .from("shipments")
    .select("id, status")
    .eq("pre_loading_id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (shipError) return fail(500, shipError.message);
  return { ok: true, pl: { id: data.id, leader_id: data.leader_id, shipment } };
}

const ALREADY_SHIPPED =
  "This pre-loading was already shipped — header and batches can't change. Undo the shipment first (PATCH status 'preloading').";

async function afterShippingChange(changedOrderIds: string[]) {
  refreshViews();
  await broadcastShipmentPing();
  await broadcastPreLoadingPing();
  if (changedOrderIds.length > 0) await broadcastOrderStatusPing({ order_ids: changedOrderIds });
  await scheduleClientNotificationDispatch();
}

export async function patchShipment(
  admin: AdminClient,
  actorId: string | null,
  id: UUID,
  input: PatchShipmentInput
): Promise<WriteResult<ShipmentRead>> {
  const loaded = await loadPl(admin, id);
  if (!loaded.ok) return loaded;
  const { pl } = loaded;

  // ---- Confirm Shipping ----
  if (input.status === "in_transit") {
    if (pl.shipment) return fail(409, "This pre-loading was already shipped.");
    const c = input.confirm!;
    const carrier = await resolveRef(admin, "carriers", c.carrier, "carrier");
    if (!carrier.ok) return carrier;
    const model = await resolveRef(admin, "shipment_models", c.shipment_model, "shipment model");
    if (!model.ok) return model;
    const shipLeader = await resolvePerson(admin, c.shipment_leader_email);
    if (!shipLeader.ok) return shipLeader;
    const signer = await resolvePerson(admin, c.signer_email);
    if (!signer.ok) return signer;
    let plLeaderId = pl.leader_id;
    if (c.preloading_leader_email) {
      const plLeader = await resolvePerson(admin, c.preloading_leader_email);
      if (!plLeader.ok) return plLeader;
      plLeaderId = plLeader.id;
    }
    if (!plLeaderId) return fail(400, "preloading_leader_email is required (the pre-loading has no leader).");

    const result = await confirmShippingRecord(
      admin,
      id,
      {
        container_number: c.container_number,
        seal_number: c.seal_number,
        estimated_date: c.estimated_date,
        loading_date_completed_on: c.loading_date_completed_on,
        shipment_leader_id: shipLeader.id!,
        preloading_leader_id: plLeaderId,
        carrier_id: carrier.id,
        shipment_model_id: model.id,
        signer_id: signer.id!,
        statuses: c.lines.map((l) => ({ ofc_id: l.item_id, status: l.loading_status })),
      },
      actorId
    );
    if (!result.ok) return fail(result.status, result.error);
    await afterShippingChange(result.changed_order_ids);
    return readBack(admin, id, 200);
  }

  // ---- Desfazer o embarque ----
  if (input.status === "preloading") {
    if (!pl.shipment) return fail(409, "This pre-loading is not shipped.");
    const { data: rpcResult, error: rpcError } = await admin.rpc("delete_shipment", {
      p_shipment_id: pl.shipment.id,
    });
    if (rpcError) return fail(409, rpcError.message);
    await afterShippingChange(rpcResult?.changed_order_ids ?? []);
    return readBack(admin, id, 200);
  }

  // ---- Cabeçalho / lotes / gss_id ----
  const touchesHeader =
    input.clients !== undefined ||
    input.client_reference !== undefined ||
    input.pod !== undefined ||
    input.leader_email !== undefined ||
    input.responsible_signer_email !== undefined ||
    input.batch_ids !== undefined;
  if (touchesHeader && pl.shipment) return fail(409, ALREADY_SHIPPED);

  const update: TablesUpdate<"pre_loadings"> = {};
  if (input.gss_id !== undefined) update.gss_id = input.gss_id;
  if (input.client_reference !== undefined) update.client_reference = input.client_reference;
  if (input.pod !== undefined) {
    const pod = await resolveRef(admin, "pods", input.pod, "pod");
    if (!pod.ok) return pod;
    update.pod_id = pod.id;
  }
  if (input.leader_email !== undefined) {
    const leader = await resolvePerson(admin, input.leader_email);
    if (!leader.ok) return leader;
    update.leader_id = leader.id;
  }
  if (input.responsible_signer_email !== undefined) {
    const signer = await resolvePerson(admin, input.responsible_signer_email);
    if (!signer.ok) return signer;
    update.responsible_signer_id = signer.id;
  }

  let clientIds: UUID[] | null = null;
  if (input.clients !== undefined) {
    clientIds = [];
    for (const ref of input.clients) {
      const r = await resolveRef(admin, "clients", ref, "client");
      if (!r.ok) return r;
      if (!clientIds.includes(r.id)) clientIds.push(r.id);
    }
  }

  let batchIds: UUID[] | null = null;
  if (input.batch_ids !== undefined) {
    const { data: current, error } = await admin
      .from("pre_loading_batches")
      .select("batch_id")
      .eq("pre_loading_id", id);
    if (error) return fail(500, error.message);
    const resolved = await resolvePlBatches(
      admin,
      input.batch_ids,
      new Set((current ?? []).map((b) => b.batch_id))
    );
    if (!resolved.ok) return resolved;
    batchIds = resolved.ids;
  }

  if (Object.keys(update).length > 0) {
    const { error } = await admin.from("pre_loadings").update(update).eq("id", id);
    if (error) {
      if (error.code === "23505") return fail(409, `gss_id '${input.gss_id}' is already used by another pre-loading.`);
      return fail(500, error.message);
    }
  }

  if (clientIds || batchIds) {
    // syncPreLoadingRelations troca os DOIS conjuntos — o que não veio fica como está.
    if (!clientIds) {
      const { data } = await admin.from("pre_loading_clients").select("client_id").eq("pre_loading_id", id);
      clientIds = (data ?? []).map((c) => c.client_id);
    }
    if (!batchIds) {
      const { data } = await admin.from("pre_loading_batches").select("batch_id").eq("pre_loading_id", id);
      batchIds = (data ?? []).map((b) => b.batch_id);
    }
    const relError = await syncPreLoadingRelations(admin, id, clientIds, batchIds);
    if (relError) return fail(500, relError);
  }

  refreshViews();
  await broadcastPreLoadingPing();
  return readBack(admin, id, 200);
}

export async function deleteShipment(
  admin: AdminClient,
  id: UUID
): Promise<WriteResult<{ id: UUID; deleted: true }>> {
  const loaded = await loadPl(admin, id);
  if (!loaded.ok) return loaded;
  if (loaded.pl.shipment) {
    return fail(409, "This pre-loading was already shipped. Undo the shipment first (PATCH status 'preloading').");
  }
  const error = await deletePreLoadingRecord(admin, id);
  if (error) return fail(500, error);
  refreshViews();
  await broadcastPreLoadingPing();
  return { ok: true, status: 200, data: { id, deleted: true } };
}

/** Coluna de cada referência das etapas → tabela do cadastro. */
const STEP_REFS: Partial<Record<keyof PatchStepInput, { column: string; table: RefTable; label: string }>> = {
  consolidation_point: { column: "consolidation_point_id", table: "factories", label: "consolidation point" },
  city: { column: "city_id", table: "cities", label: "city" },
  pol: { column: "pol_id", table: "pols", label: "port of loading" },
  carrier: { column: "carrier_id", table: "carriers", label: "carrier" },
  agent_brazil: { column: "agent_brazil_id", table: "agents", label: "agent" },
  agent_china: { column: "agent_china_id", table: "agents", label: "agent" },
  contact_brazil: { column: "contact_brazil_id", table: "contacts", label: "contact" },
  contact_china: { column: "contact_china_id", table: "contacts", label: "contact" },
};

export async function patchShipmentStep(
  admin: AdminClient,
  actor: { userId: string | null; isAdmin: boolean },
  id: UUID,
  step: string,
  input: PatchStepInput
): Promise<WriteResult<ShipmentRead>> {
  if (!(PL_CHECKLIST_STEPS as string[]).includes(step)) {
    return fail(404, `Unknown step '${step}'. Steps: ${PL_CHECKLIST_STEPS.join(", ")}.`);
  }
  const checklistStep = step as ChecklistStep;
  const allowed = new Set([...COMMON_STEP_FIELDS, ...(STEP_FIELDS[checklistStep] ?? [])]);
  const wrong = (Object.keys(input) as (keyof PatchStepInput)[]).filter(
    (k) => input[k] !== undefined && !allowed.has(k)
  );
  if (wrong.length) return fail(400, `Step '${step}' doesn't take: ${wrong.join(", ")}.`);

  const loaded = await loadPl(admin, id);
  if (!loaded.ok) return loaded;
  const { pl } = loaded;
  const isShipmentStep = SHIPMENT_STEPS.includes(checklistStep);
  if (isShipmentStep && !pl.shipment) {
    return fail(409, "Shipment steps open after Confirm Shipping (PATCH status 'in_transit').");
  }
  // Etapa do Pre-loading depois do embarque: só admin corrige (mesma trava da tela).
  if (!isShipmentStep && pl.shipment && !actor.isAdmin) {
    return fail(409, "Only an admin can edit a step inherited from the Pre-loading.");
  }

  const patch: Record<string, unknown> = {};
  if (input.estimated_date !== undefined) patch.estimated_date = input.estimated_date;
  if (input.completed_on !== undefined) patch.completed_on = input.completed_on;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.booking_number !== undefined) patch.booking_number = input.booking_number;
  if (input.cutoff_date !== undefined) patch.cutoff_date = input.cutoff_date;
  if (input.responsible_email !== undefined) {
    const person = await resolvePerson(admin, input.responsible_email);
    if (!person.ok) return person;
    patch.responsible_id = person.id;
  }
  for (const [key, spec] of Object.entries(STEP_REFS)) {
    const value = input[key as keyof PatchStepInput] as string | null | undefined;
    if (value === undefined || !spec) continue;
    if (value === null) {
      patch[spec.column] = null;
      continue;
    }
    const r = await resolveRef(admin, spec.table, value, spec.label);
    if (!r.ok) return r;
    patch[spec.column] = r.id;
  }

  const { data: existing, error: readError } = await admin
    .from("pre_loading_checklist_steps")
    .select("id, estimated_date, completed_on")
    .eq("pre_loading_id", id)
    .eq("step", checklistStep)
    .maybeSingle();
  if (readError) return fail(500, readError.message);

  // "Completed on" exige "Estimated date" e nunca é futura — mesma trava das telas.
  const dateError = validateStepDates(
    existing ?? { estimated_date: null, completed_on: null },
    patch as { estimated_date?: string | null; completed_on?: string | null }
  );
  if (dateError) return fail(400, dateError);

  const completedOn =
    "completed_on" in patch ? ((patch.completed_on as string | null) ?? null) : (existing?.completed_on ?? null);
  const values: Record<string, unknown> = { ...patch, done: completedOn != null };
  // Quem conclui a etapa assina (null = token de integração).
  if (patch.completed_on) values.signed_by_id = actor.userId;

  const { error } = existing
    ? await admin.from("pre_loading_checklist_steps").update(values as never).eq("id", existing.id)
    : await admin
        .from("pre_loading_checklist_steps")
        .insert({ pre_loading_id: id, step: checklistStep, ...values } as never);
  if (error) return fail(500, error.message);

  if (checklistStep === "delivered" && "completed_on" in patch && pl.shipment) {
    const ruleError = await applyDeliveredRule(admin, pl.shipment.id, id, completedOn != null);
    if (ruleError) return fail(500, ruleError);
    await scheduleClientNotificationDispatch();
  }

  refreshViews();
  await broadcastPreLoadingPing();
  await broadcastShipmentPing();
  return readBack(admin, id, 200);
}
