"use server";

import { revalidatePath } from "next/cache";

import { PRELOADING_STEPS } from "@/lib/checklist";
import { validateStepDates } from "@/lib/checklist-completion";
import { DOCUMENTS_BUCKET, type UploadTicket } from "@/lib/attachments";
import { isPathInDir, issueUploadTicket } from "@/lib/attachments-server";
import { scheduleClientNotificationDispatch } from "@/domain/client/notifications";
import { requireFeature } from "@/lib/dal";
import { syncOrderStatusForBatches } from "@/lib/order-status";
import { broadcastOrderStatusPing } from "@/lib/orders-realtime";
import { broadcastShipmentPing } from "@/lib/shipments-realtime";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ChecklistStep } from "@/types/database";

type ActionResult = { ok: true } | { ok: false; error: string };


/**
 * Campos editáveis nas etapas da fase Shipment. Nenhuma delas tem campo
 * específico além do texto aberto de Original Docs (docs §3.10.4).
 */
export type ShipmentStepPatch = Partial<{
  estimated_date: string | null;
  responsible_id: string | null;
  completed_on: string | null;
  notes: string | null;
}>;

type Admin = ReturnType<typeof createAdminClient>;

/** Pelo padrão da rota, não por valor: a página de Shipment vive em duas URLs
 *  (pl_number bonito e UUID antigo) — isto invalida as duas de uma vez. */
function revalidateShipmentViews() {
  revalidatePath("/shipments/[id]", "page");
  revalidatePath("/shipments");
}

/**
 * As etapas #11–17 são preenchidas na tela de Pre-loading e chegam aqui só para
 * leitura — o embarque já foi confirmado em cima delas. Admin (e owner) pode
 * corrigir mesmo assim; para os demais a tela mostra cadeado e o servidor
 * recusa, senão bastaria chamar a action direto.
 */
function canEditInheritedStep(
  step: ChecklistStep,
  session: { isAdmin: boolean; isOwner: boolean }
): boolean {
  return !PRELOADING_STEPS.includes(step) || session.isAdmin || session.isOwner;
}

const INHERITED_DENIED = "Only an admin can edit a step inherited from the Pre-loading.";

/** Id da etapa, criando a linha se ainda não existir. */
async function ensureStepId(
  admin: Admin,
  preLoadingId: string,
  step: ChecklistStep
): Promise<{ id: string } | { error: string }> {
  const { data: existing, error: readError } = await admin
    .from("pre_loading_checklist_steps")
    .select("id")
    .eq("pre_loading_id", preLoadingId)
    .eq("step", step)
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (existing) return { id: existing.id };

  const { data, error } = await admin
    .from("pre_loading_checklist_steps")
    .insert({ pre_loading_id: preLoadingId, step })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not create the step." };
  return { id: data.id };
}

/**
 * Conclusão da etapa "Delivered" (#24) encerra a esteira: todos os lotes do
 * embarque vão para `delivered` e o Shipment também (docs §3.10.4). Limpar a
 * data reabre — os lotes voltam para `in_transit`.
 */
async function applyDeliveredRule(
  admin: Admin,
  shipmentId: string,
  preLoadingId: string,
  delivered: boolean
): Promise<string | null> {
  const { data: links, error: linkError } = await admin
    .from("pre_loading_batches")
    .select("batch_id")
    .eq("pre_loading_id", preLoadingId);
  if (linkError) return linkError.message;

  const batchIds = (links ?? []).map((l) => l.batch_id);
  if (batchIds.length) {
    const { error } = await admin
      .from("batches")
      .update({ status: delivered ? "delivered" : "in_transit" })
      .in("id", batchIds);
    if (error) return error.message;

    // Entrega fecha (ou reabre) a esteira dos lotes: as Orders viram
    // Delivered / Partially Delivered pelo rollup (§3.7.1).
    const statusError = await syncOrderStatusForBatches(admin, batchIds);
    if (statusError) return statusError;
  }

  const { error: shipmentError } = await admin
    .from("shipments")
    .update({ status: delivered ? "delivered" : "in_transit" })
    .eq("id", shipmentId);
  return shipmentError?.message ?? null;
}

/**
 * Grava um campo de uma etapa da fase Shipment. O checklist é o MESMO do
 * Pre-loading (`pre_loading_checklist_steps`, ancorado no pre_loading_id —
 * docs §3.9.5), por isso a escrita é na mesma tabela; muda só o que a tela
 * deixa editar e a revalidação.
 */
export async function saveShipmentStep(
  shipmentId: string,
  preLoadingId: string,
  step: ChecklistStep,
  patch: ShipmentStepPatch
): Promise<ActionResult> {
  const session = await requireFeature("shipments", "edit");
  if (!canEditInheritedStep(step, session)) return { ok: false, error: INHERITED_DENIED };
  const admin = createAdminClient();

  const { data: existing, error: readError } = await admin
    .from("pre_loading_checklist_steps")
    .select("id, estimated_date, completed_on")
    .eq("pre_loading_id", preLoadingId)
    .eq("step", step)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };

  // "Completed on" exige "Estimated date" — travado também aqui, não só na UI.
  const dateError = validateStepDates(
    existing ?? { estimated_date: null, completed_on: null },
    patch
  );
  if (dateError) return { ok: false, error: dateError };

  const completedOn =
    "completed_on" in patch ? (patch.completed_on ?? null) : (existing?.completed_on ?? null);
  const values: ShipmentStepPatch & { done: boolean; signed_by_id?: string } = {
    ...patch,
    done: completedOn != null,
  };

  // Quem conclui a etapa assina — mesma regra do checklist de Pre-loading.
  if (patch.completed_on) values.signed_by_id = session.userId;

  const { error } = existing
    ? await admin.from("pre_loading_checklist_steps").update(values).eq("id", existing.id)
    : await admin
        .from("pre_loading_checklist_steps")
        .insert({ pre_loading_id: preLoadingId, step, ...values });
  if (error) return { ok: false, error: error.message };

  if (step === "delivered" && "completed_on" in patch) {
    const ruleError = await applyDeliveredRule(
      admin,
      shipmentId,
      preLoadingId,
      completedOn != null
    );
    if (ruleError) return { ok: false, error: ruleError };
  }

  revalidateShipmentViews();
  // Atribuir/trocar responsável ou concluir/reabrir etapa muda a To do list.
  revalidatePath("/todo");
  // Realtime: colunas da lista Shipments (datas/status) mudaram — atualiza quem
  // está com ela aberta e parada.
  await broadcastShipmentPing();
  return { ok: true };
}

/**
 * Upload de anexo em 2 actions (ticket + registro) — o arquivo vai direto do
 * browser pro Storage, nunca por aqui (limite de 4,5MB da Vercel; ver
 * lib/attachments.ts). Mesmo prefixo do Pre-loading: o anexo é da etapa do PL.
 */
function attachmentDir(preLoadingId: string, stepRowId: string) {
  return `pre-loading/${preLoadingId}/${stepRowId}`;
}

export async function createShipmentAttachmentTicket(
  preLoadingId: string,
  step: ChecklistStep,
  fileName: string,
  fileSize: number
): Promise<UploadTicket> {
  const session = await requireFeature("shipments", "edit");
  if (!canEditInheritedStep(step, session)) return { ok: false, error: INHERITED_DENIED };
  const admin = createAdminClient();

  const stepRow = await ensureStepId(admin, preLoadingId, step);
  if ("error" in stepRow) return { ok: false, error: stepRow.error };

  return issueUploadTicket(admin, attachmentDir(preLoadingId, stepRow.id), fileName, fileSize);
}

export async function registerShipmentAttachment(
  preLoadingId: string,
  step: ChecklistStep,
  filePath: string,
  fileName: string
): Promise<ActionResult> {
  const session = await requireFeature("shipments", "edit");
  if (!canEditInheritedStep(step, session)) return { ok: false, error: INHERITED_DENIED };
  const admin = createAdminClient();

  const stepRow = await ensureStepId(admin, preLoadingId, step);
  if ("error" in stepRow) return { ok: false, error: stepRow.error };
  if (!isPathInDir(filePath, attachmentDir(preLoadingId, stepRow.id))) {
    return { ok: false, error: "Invalid file path." };
  }

  const { error: insertError } = await admin.from("step_attachments").insert({
    pre_loading_step_id: stepRow.id,
    file_path: filePath,
    file_name: fileName,
    uploaded_by: session.userId,
  });
  if (insertError) {
    await admin.storage.from(DOCUMENTS_BUCKET).remove([filePath]);
    return { ok: false, error: insertError.message };
  }

  revalidateShipmentViews();
  return { ok: true };
}

export async function getShipmentAttachmentUrl(
  filePath: string,
  fileName?: string | null
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireFeature("shipments", "view");
  const admin = createAdminClient();

  // `{ download }` força Content-Disposition: attachment (baixa em vez de abrir
  // inline numa aba em branco).
  const { data, error } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(filePath, 60, { download: fileName ?? true });
  if (error || !data) return { ok: false, error: error?.message ?? "Failed to sign URL." };

  return { ok: true, url: data.signedUrl };
}

export async function deleteShipmentStepAttachment(
  shipmentId: string,
  attachmentId: string,
  filePath: string
): Promise<ActionResult> {
  const session = await requireFeature("shipments", "edit");
  const admin = createAdminClient();

  // A etapa não vem por parâmetro: resolve pelo anexo para aplicar a mesma
  // trava das etapas herdadas do Pre-loading.
  const { data: att, error: attErr } = await admin
    .from("step_attachments")
    .select("pre_loading_checklist_steps(step)")
    .eq("id", attachmentId)
    .maybeSingle<{ pre_loading_checklist_steps: { step: ChecklistStep } | null }>();
  if (attErr) return { ok: false, error: attErr.message };
  const attStep = att?.pre_loading_checklist_steps?.step;
  if (attStep && !canEditInheritedStep(attStep, session)) {
    return { ok: false, error: INHERITED_DENIED };
  }

  const { error } = await admin.from("step_attachments").delete().eq("id", attachmentId);
  if (error) return { ok: false, error: error.message };

  await admin.storage.from(DOCUMENTS_BUCKET).remove([filePath]);

  revalidateShipmentViews();
  return { ok: true };
}

/**
 * Exclui um Shipment desfazendo o "Confirm Shipping" (inverso de `confirmShipping`
 * em pre-loading/[id]/actions.ts): os lotes voltam para `preloading`, o split é
 * revertido e o Pre-loading é MANTIDO — some o `shipping_confirmed_at`, então ele
 * reaparece na lista de Pre-loading pronto pra confirmar de novo (regra do QA).
 *
 * Só é possível quando os lotes criados pelo split ainda estão intactos
 * (`in_production`, fora de qualquer PL, sem terem sido divididos de novo). Se um
 * deles já avançou, reverter bagunçaria o estado — então bloqueia.
 *
 * Guards + escrita rodam na RPC `delete_shipment` (atômica) — ver
 * supabase/migrations/20260917120000_shipping_atomic.sql. Esta action só faz o
 * `requireFeature` (autorização não é responsabilidade do banco) e repassa o
 * resultado.
 */
export async function deleteShipment(shipmentId: string): Promise<ActionResult> {
  // Exige o `delete` da feature: desfazer um embarque reverte split, status de
  // lote e rollup de Order em cascata — é a ação mais destrutiva da tela e não
  // tem lixeira. O seed da migration mantém isso só com admin, como era antes.
  await requireFeature("shipments", "delete");
  const admin = createAdminClient();

  // Guards (shipment existe? não é delivered? lotes do split intactos?) +
  // reversão do split + apagar o shipment — tudo numa função de banco (RPC),
  // rodando como uma única transação. Ver
  // supabase/migrations/20260917120000_shipping_atomic.sql.
  const { data: rpcResult, error: rpcError } = await admin.rpc("delete_shipment", {
    p_shipment_id: shipmentId,
  });
  if (rpcError) return { ok: false, error: rpcError.message };

  revalidatePath("/shipments");
  revalidatePath("/pre-loading");
  revalidatePath("/orders");
  // Realtime: embarque excluído sai da lista Shipments na hora.
  await broadcastShipmentPing();
  const changedOrderIds = rpcResult?.changed_order_ids ?? [];
  if (changedOrderIds.length > 0) {
    await broadcastOrderStatusPing({ order_ids: changedOrderIds });
  }
  await scheduleClientNotificationDispatch();
  return { ok: true };
}
