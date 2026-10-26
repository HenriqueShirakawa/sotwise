"use server";

import { revalidatePath } from "next/cache";

import { PRELOADING_STEPS } from "@/lib/checklist";
import {
  LOCKED_COMPLETED_ON_ERROR,
  LOCKED_COMPLETED_ON_STEPS,
  validateStepDates,
} from "@/lib/checklist-completion";
import {
  diffStepFields,
  PL_STEP_LOG_COLUMNS,
  readAttachmentForLog,
  writeStepLog,
} from "@/lib/checklist-step-log";
import { DOCUMENTS_BUCKET, type UploadTicket } from "@/lib/attachments";
import { isPathInDir, issueUploadTicket } from "@/lib/attachments-server";
import { scheduleClientNotificationDispatch } from "@/domain/client/notifications";
import { requireFeature } from "@/lib/dal";
import { applyDeliveredRule } from "@/domain/shipments/delivered";
import { broadcastOrderStatusPing } from "@/lib/orders-realtime";
import { autoCompletePlStep } from "@/lib/pl-step-autocomplete";
import { setPlStepEventDate } from "@/lib/pl-step-event-date";
import {
  fillDeliveredForAllClients,
  setClientDeliveredDate,
  setClientOriginalDocs,
} from "@/lib/pl-client-steps";
import { isClientDocStep } from "@/lib/pl-clients";
import { broadcastShipmentPing } from "@/lib/shipments-realtime";
import { createAdminClient } from "@/lib/supabase/admin";
import { isGssShipmentStep, sendOrderStatusToGss, sendPlShipmentToGss } from "@/lib/gss/outbound/schedule";
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

/** Regra do Delivered (lotes + embarque) a partir do PL. */
async function applyDeliveredRuleForPl(
  admin: Admin,
  preLoadingId: string,
  delivered: boolean
): Promise<string | null> {
  const { data: shipment, error } = await admin
    .from("shipments")
    .select("id")
    .eq("pre_loading_id", preLoadingId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return error.message;
  if (!shipment) return null;
  const ruleError = await applyDeliveredRule(admin, shipment.id, preLoadingId, delivered);
  if (ruleError) return ruleError;
  await scheduleClientNotificationDispatch();
  return null;
}

/**
 * Shipping Date / ETA / ATA / Delivered: grava a data do fato (21/10/2026, ver
 * lib/pl-step-event-date). A 1ª conclui a etapa; trocar depois exige motivo.
 * Concluir o Delivered entrega lotes e embarque, como antes fazia o Completed on.
 */
export async function saveShipmentEventDate(
  preLoadingId: string,
  step: ChecklistStep,
  date: string,
  reason: string | null
): Promise<ActionResult> {
  const session = await requireFeature("shipments", "edit");
  const admin = createAdminClient();

  const { error, completed } = await setPlStepEventDate(admin, preLoadingId, step, date, {
    userId: session.userId,
    reason,
  });
  if (error) return { ok: false, error };
  // Delivered com data única num PL de 2+ clientes: vale para todos eles.
  if (step === "delivered") {
    const fillError = await fillDeliveredForAllClients(admin, preLoadingId, date);
    if (fillError) return { ok: false, error: fillError };
  }

  if (step === "delivered" && completed) {
    const ruleError = await applyDeliveredRuleForPl(admin, preLoadingId, true);
    if (ruleError) return { ok: false, error: ruleError };
  }

  revalidateShipmentViews();
  revalidatePath("/todo");
  await broadcastShipmentPing();
  if (isGssShipmentStep(step)) sendPlShipmentToGss(preLoadingId);
  return { ok: true };
}

/**
 * Original Docs de um cliente (22/10/2026): Tracking number OU Telex release.
 * Ver lib/pl-client-steps.
 */
export async function saveShipmentClientOriginalDocs(
  preLoadingId: string,
  clientId: string,
  patch: { tracking_number?: string | null; telex_release?: boolean }
): Promise<ActionResult> {
  const session = await requireFeature("shipments", "edit");
  const admin = createAdminClient();
  const { error, completed } = await setClientOriginalDocs(
    admin,
    preLoadingId,
    clientId,
    patch,
    session.userId
  );
  if (error) return { ok: false, error };
  revalidateShipmentViews();
  if (completed) {
    revalidatePath("/todo");
    await broadcastShipmentPing();
  }
  return { ok: true };
}

/**
 * Delivered date de um cliente (PL com 2+ clientes, 22/10/2026). A última que
 * faltava conclui a etapa — e entrega lotes e embarque, como a data única.
 */
export async function saveShipmentClientDelivered(
  preLoadingId: string,
  clientId: string,
  date: string,
  reason: string | null
): Promise<ActionResult> {
  const session = await requireFeature("shipments", "edit");
  const admin = createAdminClient();
  const { error, completed } = await setClientDeliveredDate(admin, preLoadingId, clientId, date, {
    userId: session.userId,
    reason,
  });
  if (error) return { ok: false, error };
  if (completed) {
    const ruleError = await applyDeliveredRuleForPl(admin, preLoadingId, true);
    if (ruleError) return { ok: false, error: ruleError };
  }
  revalidateShipmentViews();
  revalidatePath("/todo");
  await broadcastShipmentPing();
  if (isGssShipmentStep("delivered")) sendPlShipmentToGss(preLoadingId);
  return { ok: true };
}

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
    .select(PL_STEP_LOG_COLUMNS)
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

  // Etapa com gatilho (BL, Original Docs…): a data é da auto-conclusão —
  // imutável, ninguém edita (22/10/2026).
  if (
    "completed_on" in patch &&
    (patch.completed_on ?? null) !== (existing?.completed_on ?? null) &&
    LOCKED_COMPLETED_ON_STEPS.has(step)
  ) {
    return { ok: false, error: LOCKED_COMPLETED_ON_ERROR };
  }

  const completedOn =
    "completed_on" in patch ? (patch.completed_on ?? null) : (existing?.completed_on ?? null);
  const values: ShipmentStepPatch & { done: boolean; signed_by_id?: string } = {
    ...patch,
    done: completedOn != null,
  };

  // Quem conclui a etapa assina — mesma regra do checklist de Pre-loading.
  if (patch.completed_on) values.signed_by_id = session.userId;

  const { data: saved, error } = existing
    ? await admin
        .from("pre_loading_checklist_steps")
        .update(values)
        .eq("id", existing.id)
        .select("id")
        .single()
    : await admin
        .from("pre_loading_checklist_steps")
        .insert({ pre_loading_id: preLoadingId, step, ...values })
        .select("id")
        .single();
  if (error || !saved) return { ok: false, error: error?.message ?? "Could not save the step." };

  await writeStepLog(admin, {
    owner: { preLoadingStepId: saved.id },
    step,
    action: "update",
    changes: diffStepFields(existing, values),
    userId: session.userId,
  });

  if (step === "delivered" && "completed_on" in patch) {
    const ruleError = await applyDeliveredRule(
      admin,
      shipmentId,
      preLoadingId,
      completedOn != null
    );
    if (ruleError) return { ok: false, error: ruleError };
  }

  // Data prevista posta numa etapa que já tinha o documento: fecha sozinha
  // (ver lib/pl-step-autocomplete). Limpar o "Completed on" à mão não reabre-fecha.
  if (!("completed_on" in patch) && "estimated_date" in patch) {
    await autoCompletePlStep(admin, preLoadingId, step, session.userId);
  }

  revalidateShipmentViews();
  // Atribuir/trocar responsável ou concluir/reabrir etapa muda a To do list.
  revalidatePath("/todo");
  // Realtime: colunas da lista Shipments (datas/status) mudaram — atualiza quem
  // está com ela aberta e parada.
  await broadcastShipmentPing();
  // Data de Shipping date / ETA / ATA / Delivered mudou → GSS na hora.
  if (isGssShipmentStep(step)) sendPlShipmentToGss(preLoadingId);
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
  fileName: string,
  /** Documento de um cliente (BL / Original Docs por cliente, 22/10/2026). */
  clientId: string | null = null
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
    client_id: isClientDocStep(step) ? clientId : null,
  });
  if (insertError) {
    await admin.storage.from(DOCUMENTS_BUCKET).remove([filePath]);
    return { ok: false, error: insertError.message };
  }

  await writeStepLog(admin, {
    owner: { preLoadingStepId: stepRow.id },
    step,
    action: "attachment_added",
    changes: {
      file_name: fileName,
      ...(isClientDocStep(step) && clientId ? { client_id: clientId } : {}),
    },
    userId: session.userId,
  });

  // O anexo pode ser o que faltava pra etapa fechar (BL, Original Docs…); com
  // ela já concluída, documento novo regrava o Completed on (22/10/2026).
  const completed = await autoCompletePlStep(admin, preLoadingId, step, session.userId, {
    refresh: true,
  });

  revalidateShipmentViews();
  if (completed) {
    revalidatePath("/todo");
    await broadcastShipmentPing();
  }
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
    .select("pre_loading_checklist_steps(step, pre_loading_id)")
    .eq("id", attachmentId)
    .maybeSingle<{
      pre_loading_checklist_steps: { step: ChecklistStep; pre_loading_id: string } | null;
    }>();
  if (attErr) return { ok: false, error: attErr.message };
  const attStep = att?.pre_loading_checklist_steps?.step;
  const attPreLoadingId = att?.pre_loading_checklist_steps?.pre_loading_id;
  if (attStep && !canEditInheritedStep(attStep, session)) {
    return { ok: false, error: INHERITED_DENIED };
  }

  const removed = await readAttachmentForLog(admin, attachmentId);

  const { error } = await admin.from("step_attachments").delete().eq("id", attachmentId);
  if (error) return { ok: false, error: error.message };

  if (removed) {
    await writeStepLog(admin, {
      ...removed,
      action: "attachment_removed",
      userId: session.userId,
    });
  }

  await admin.storage.from(DOCUMENTS_BUCKET).remove([filePath]);

  // Sem o documento a etapa (BL, Original Docs…) pode deixar de valer: reabre.
  const reopened =
    attStep && attPreLoadingId
      ? await autoCompletePlStep(admin, attPreLoadingId, attStep, session.userId, { refresh: true })
      : false;

  revalidateShipmentViews();
  if (reopened) {
    revalidatePath("/todo");
    await broadcastShipmentPing();
  }
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

  // O PL volta a preloading — o GSS recebe a fase de volta.
  if (rpcResult?.pre_loading_id) sendPlShipmentToGss(rpcResult.pre_loading_id);

  revalidatePath("/shipments");
  revalidatePath("/pre-loading");
  revalidatePath("/orders");
  // Realtime: embarque excluído sai da lista Shipments na hora.
  await broadcastShipmentPing();
  const changedOrderIds = rpcResult?.changed_order_ids ?? [];
  if (changedOrderIds.length > 0) {
    await broadcastOrderStatusPing({ order_ids: changedOrderIds });
    sendOrderStatusToGss(changedOrderIds);
  }
  await scheduleClientNotificationDispatch();
  return { ok: true };
}
