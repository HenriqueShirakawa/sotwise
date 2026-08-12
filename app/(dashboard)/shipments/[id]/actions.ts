"use server";

import { revalidatePath } from "next/cache";

import { PRELOADING_STEPS } from "@/lib/checklist";
import { validateStepDates } from "@/lib/checklist-completion";
import { requireFeature } from "@/lib/dal";
import { syncOrderStatusForBatches } from "@/lib/order-status";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ChecklistStep } from "@/types/database";

type ActionResult = { ok: true } | { ok: false; error: string };

const DOCUMENTS_BUCKET = "order-documents";
const MAX_FILE_BYTES = 20 * 1024 * 1024;

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

function paths(shipmentId: string) {
  return [`/shipments/${shipmentId}`, "/shipments"];
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

  for (const p of paths(shipmentId)) revalidatePath(p);
  return { ok: true };
}

export async function uploadShipmentStepAttachment(
  shipmentId: string,
  preLoadingId: string,
  step: ChecklistStep,
  formData: FormData
): Promise<ActionResult> {
  const session = await requireFeature("shipments", "edit");
  if (!canEditInheritedStep(step, session)) return { ok: false, error: INHERITED_DENIED };
  const admin = createAdminClient();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file selected." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: "File is larger than 20MB." };
  }

  const stepRow = await ensureStepId(admin, preLoadingId, step);
  if ("error" in stepRow) return { ok: false, error: stepRow.error };

  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const filePath = `pre-loading/${preLoadingId}/${stepRow.id}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(filePath, file, { contentType: file.type || undefined });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { error: insertError } = await admin.from("step_attachments").insert({
    pre_loading_step_id: stepRow.id,
    file_path: filePath,
    file_name: file.name,
    uploaded_by: session.userId,
  });
  if (insertError) {
    await admin.storage.from(DOCUMENTS_BUCKET).remove([filePath]);
    return { ok: false, error: insertError.message };
  }

  for (const p of paths(shipmentId)) revalidatePath(p);
  return { ok: true };
}

export async function getShipmentAttachmentUrl(
  filePath: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireFeature("shipments", "view");
  const admin = createAdminClient();

  const { data, error } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(filePath, 60);
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

  for (const p of paths(shipmentId)) revalidatePath(p);
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
 * Sem transação (mesma limitação de `confirmShipping`); a ordem minimiza estado
 * inconsistente caso falhe no meio.
 */
export async function deleteShipment(shipmentId: string): Promise<ActionResult> {
  // Exige o `delete` da feature: desfazer um embarque reverte split, status de
  // lote e rollup de Order em cascata — é a ação mais destrutiva da tela e não
  // tem lixeira. O seed da migration mantém isso só com admin, como era antes.
  await requireFeature("shipments", "delete");
  const admin = createAdminClient();

  const { data: shipment, error: shipErr } = await admin
    .from("shipments")
    .select("id, pre_loading_id, status, created_at")
    .eq("id", shipmentId)
    .maybeSingle();
  if (shipErr) return { ok: false, error: shipErr.message };
  if (!shipment) return { ok: false, error: "Shipment not found." };
  // Embarque entregue não se desfaz: a carga chegou, e reverter mexeria no
  // status de lotes e Orders já encerrados.
  if (shipment.status === "delivered") {
    return { ok: false, error: "A delivered shipment can't be deleted." };
  }

  // Lotes embarcados = os lotes do PL.
  const { data: links, error: linkErr } = await admin
    .from("pre_loading_batches")
    .select("batch_id")
    .eq("pre_loading_id", shipment.pre_loading_id);
  if (linkErr) return { ok: false, error: linkErr.message };
  const origIds = (links ?? []).map((l) => l.batch_id);
  if (origIds.length === 0) return { ok: false, error: "Shipment has no batches." };

  // Lotes que receberam a parte que NÃO embarcou. Dois casos, separados pela
  // data de criação: os que NASCERAM neste split (depois do embarque) e os que
  // já existiam e só receberam as linhas (regra do "próximo lote aberto" em
  // confirmShipping). Apagar um lote que já existia levaria junto a produção
  // que era dele — por isso a distinção.
  const { data: children, error: childErr } = await admin
    .from("batches")
    .select("id, status, split_from_batch_id, created_at")
    .in("split_from_batch_id", origIds);
  if (childErr) return { ok: false, error: childErr.message };
  const childIds = (children ?? []).map((c) => c.id);
  // O shipment é gravado ANTES do split (ver confirmShipping), então o lote que
  // nasceu ali é sempre mais novo que ele.
  const shipmentAt = Date.parse(shipment.created_at);
  const bornHere = (children ?? []).filter((c) => Date.parse(c.created_at) >= shipmentAt);
  const merged = (children ?? []).filter((c) => Date.parse(c.created_at) < shipmentAt);

  // Guard: só reverte se cada lote do split continua intacto.
  if (childIds.length) {
    if (bornHere.some((c) => c.status !== "in_production")) {
      return {
        ok: false,
        error: "Can't undo this shipment: a batch created by the split already moved forward.",
      };
    }
    // O lote que já existia pode estar em negociação ou produção; qualquer
    // coisa além disso quer dizer que a produção dele já seguiu.
    if (merged.some((c) => c.status !== "in_production" && c.status !== "in_negotiation")) {
      return {
        ok: false,
        error: "Can't undo this shipment: the batch that received the split already moved forward.",
      };
    }
    const { data: childInPl, error: e1 } = await admin
      .from("pre_loading_batches")
      .select("batch_id")
      .in("batch_id", childIds);
    if (e1) return { ok: false, error: e1.message };
    if (childInPl && childInPl.length) {
      return {
        ok: false,
        error: "Can't undo this shipment: a split batch is already in another Pre-loading.",
      };
    }
    const { data: grandkids, error: e2 } = await admin
      .from("batches")
      .select("id")
      .in("split_from_batch_id", childIds);
    if (e2) return { ok: false, error: e2.message };
    if (grandkids && grandkids.length) {
      return {
        ok: false,
        error: "Can't undo this shipment: a split batch was split again.",
      };
    }
  }

  // Desfaz o split: cada linha Factory×Category volta ao lote de origem...
  for (const child of bornHere) {
    const { error } = await admin
      .from("order_factory_category")
      .update({ batch_id: child.split_from_batch_id })
      .eq("batch_id", child.id);
    if (error) return { ok: false, error: error.message };
  }
  // ...e os lotes que nasceram no split somem.
  if (bornHere.length) {
    const { error } = await admin
      .from("batches")
      .delete()
      .in("id", bornHere.map((c) => c.id));
    if (error) return { ok: false, error: error.message };
  }

  // No lote que já existia, voltam só as linhas que ESTE embarque empurrou pra
  // lá — reconhecíveis pelo loading_status gravado no Confirm Shipping. O que
  // era dele fica onde está, e o lote não é apagado.
  for (const child of merged) {
    const { error } = await admin
      .from("order_factory_category")
      .update({ batch_id: child.split_from_batch_id })
      .eq("batch_id", child.id)
      .in("loading_status", ["none", "partial"]);
    if (error) return { ok: false, error: error.message };

    // A linhagem foi anotada por este embarque; sem ele, o lote volta a não ter
    // origem registrada.
    const { error: lnErr } = await admin
      .from("batches")
      .update({ split_from_batch_id: null })
      .eq("id", child.id);
    if (lnErr) return { ok: false, error: lnErr.message };
  }

  // O loading_status era do embarque desfeito.
  const { error: lsErr } = await admin
    .from("order_factory_category")
    .update({ loading_status: null })
    .in("batch_id", origIds);
  if (lsErr) return { ok: false, error: lsErr.message };

  // Os lotes voltam para a fase de Pre-loading (revertem de in_transit ou delivered).
  const { error: stErr } = await admin
    .from("batches")
    .update({ status: "preloading" })
    .in("id", origIds);
  if (stErr) return { ok: false, error: stErr.message };

  const { error: rmErr } = await admin.from("shipments").delete().eq("id", shipmentId);
  if (rmErr) return { ok: false, error: rmErr.message };

  // Reabre o PL: sem shipping_confirmed_at ele volta à lista de Pre-loading.
  const { error: plErr } = await admin
    .from("pre_loadings")
    .update({ shipping_confirmed_at: null })
    .eq("id", shipment.pre_loading_id);
  if (plErr) return { ok: false, error: plErr.message };

  // Rollup: as Orders voltam de Shipped/Partially Shipped para pre_loading/partially.
  const statusError = await syncOrderStatusForBatches(admin, origIds);
  if (statusError) return { ok: false, error: statusError };

  revalidatePath("/shipments");
  revalidatePath("/pre-loading");
  revalidatePath("/orders");
  return { ok: true };
}
