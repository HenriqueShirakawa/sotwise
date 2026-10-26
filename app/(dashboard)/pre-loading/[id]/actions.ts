"use server";

import { revalidatePath } from "next/cache";

import {
  LOCKED_COMPLETED_ON_ERROR,
  LOCKED_COMPLETED_ON_STEPS,
  validateStepDates,
} from "@/lib/checklist-completion";
import { todayIso } from "@/lib/format";
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
import { confirmShippingRecord, type ConfirmShippingInput } from "@/domain/shipments/confirm";
import { autoCompletePlStep } from "@/lib/pl-step-autocomplete";
import { broadcastOrderStatusPing } from "@/lib/orders-realtime";
import { broadcastPreLoadingPing } from "@/lib/preloading-realtime";
import { broadcastShipmentPing } from "@/lib/shipments-realtime";
import { createAdminClient } from "@/lib/supabase/admin";
import { isGssShipmentStep, sendOrderStatusToGss, sendPlShipmentToGss } from "@/lib/gss/outbound/schedule";
import type { ChecklistStep } from "@/types/database";

type ActionResult = { ok: true } | { ok: false; error: string };


/** Campos editáveis de uma etapa — padrão + específicos (ver docs §3.9.5). */
export type StepPatch = Partial<{
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
  cutoff_date: string | null;
  doc_cutoff_date: string | null;
}>;

/** Campos que entram na regra de conclusão — só eles disparam a auto-conclusão. */
const COMPLETION_FACT_FIELDS: (keyof StepPatch)[] = [
  "estimated_date",
  "consolidation_point_id",
  "city_id",
  "pol_id",
  "carrier_id",
  "agent_brazil_id",
  "agent_china_id",
  "contact_brazil_id",
  "contact_china_id",
  "booking_number",
  "cutoff_date",
  "doc_cutoff_date",
];

function touchesCompletionFacts(patch: StepPatch): boolean {
  return COMPLETION_FACT_FIELDS.some((k) => k in patch);
}

/** Mudou o dado da etapa (não só a previsão)? Regrava o Completed on — 22/10/2026. */
function touchesStepData(patch: StepPatch): boolean {
  return COMPLETION_FACT_FIELDS.some((k) => k !== "estimated_date" && k in patch);
}

/**
 * Grava um campo de uma etapa do checklist do PL. As linhas de
 * `pre_loading_checklist_steps` nascem sob demanda — um PL recém-criado não
 * tem nenhuma —, por isso é upsert pela chave lógica (pre_loading_id, step).
 *
 * A coluna `done` é só o espelho de `completed_on` — não há toggle manual nesta
 * tela (docs/regras_de_negocio.md §3.9.5). Quem decide se a etapa aparece como
 * concluída é `lib/checklist-completion`, aplicada na LEITURA: a condição da
 * etapa envolve anexos e outros campos que mudam fora deste save, então gravar
 * o resultado aqui só criaria valor velho.
 */
export async function savePreLoadingStep(
  preLoadingId: string,
  step: ChecklistStep,
  patch: StepPatch
): Promise<ActionResult> {
  const session = await requireFeature("pre_loading", "edit");
  const admin = createAdminClient();

  const { data: existing, error: readError } = await admin
    .from("pre_loading_checklist_steps")
    .select(PL_STEP_LOG_COLUMNS)
    .eq("pre_loading_id", preLoadingId)
    .eq("step", step)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };

  // "Completed on" exige "Estimated date" — travado também aqui, não só na UI.
  // Etapa que ainda não existe no banco entra como as duas datas vazias.
  const dateError = validateStepDates(
    existing ?? { estimated_date: null, completed_on: null },
    patch
  );
  if (dateError) return { ok: false, error: dateError };

  // Etapa com gatilho: a data é da auto-conclusão — imutável, ninguém edita
  // (22/10/2026).
  if (
    "completed_on" in patch &&
    (patch.completed_on ?? null) !== (existing?.completed_on ?? null) &&
    LOCKED_COMPLETED_ON_STEPS.has(step)
  ) {
    return { ok: false, error: LOCKED_COMPLETED_ON_ERROR };
  }

  // "completed_on" no patch redefine o `done`; fora isso mantém o que já valia.
  const completedOn =
    "completed_on" in patch ? (patch.completed_on ?? null) : (existing?.completed_on ?? null);
  const values: StepPatch & { done: boolean } = { ...patch, done: completedOn != null };

  // Definir "Completed on" autopreenche "Signed by" com o usuário atual — quem
  // conclui a etapa assina (mesma regra do checklist de Orders). Só ao definir,
  // não ao limpar; o campo é travado na UI, então signed_by nunca vem no patch.
  if (patch.completed_on && patch.signed_by_id === undefined) {
    values.signed_by_id = session.userId;
  }

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

  // Preencheu o que a etapa exige (cadastro/booking/data prevista)? Fecha sozinha
  // — e, já concluída, a mudança do dado regrava o Completed on (a última
  // atualização, 22/10/2026).
  if (!("completed_on" in patch) && touchesCompletionFacts(patch)) {
    await autoCompletePlStep(admin, preLoadingId, step, session.userId, {
      refresh: touchesStepData(patch),
    });
  }

  // Pelo padrão da rota, não por valor: a página vive em duas URLs (pl_number
  // bonito e UUID antigo) — isto invalida as duas de uma vez.
  revalidatePath("/pre-loading/[id]", "page");
  revalidatePath("/pre-loading");
  // Atribuir/trocar responsável ou concluir/reabrir etapa muda a To do list.
  revalidatePath("/todo");
  // Realtime: colunas da lista Pre-loading (datas/booking) mudaram.
  await broadcastPreLoadingPing();
  // Data do Loading date mudou → GSS na hora (depois da resposta).
  if (isGssShipmentStep(step)) sendPlShipmentToGss(preLoadingId);
  return { ok: true };
}


/** Id da etapa, criando a linha se ainda não existir (anexar antes de editar). */
async function ensureStepId(
  admin: ReturnType<typeof createAdminClient>,
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
 * Upload de anexo em 2 actions (ticket + registro) — o arquivo vai direto do
 * browser pro Storage, nunca por aqui (limite de 4,5MB da Vercel; ver
 * lib/attachments.ts). O ticket já cria a linha da etapa se ela não existir.
 */
function attachmentDir(preLoadingId: string, stepRowId: string) {
  return `pre-loading/${preLoadingId}/${stepRowId}`;
}

export async function createPreLoadingAttachmentTicket(
  preLoadingId: string,
  step: ChecklistStep,
  fileName: string,
  fileSize: number
): Promise<UploadTicket> {
  await requireFeature("pre_loading", "edit");
  const admin = createAdminClient();

  const stepRow = await ensureStepId(admin, preLoadingId, step);
  if ("error" in stepRow) return { ok: false, error: stepRow.error };

  return issueUploadTicket(admin, attachmentDir(preLoadingId, stepRow.id), fileName, fileSize);
}

export async function registerPreLoadingAttachment(
  preLoadingId: string,
  step: ChecklistStep,
  filePath: string,
  fileName: string,
  /** Shipping Docs de PL com 2+ clientes: o cliente do documento (21/10/2026). */
  clientId: string | null = null
): Promise<ActionResult> {
  const session = await requireFeature("pre_loading", "edit");
  const admin = createAdminClient();

  const stepRow = await ensureStepId(admin, preLoadingId, step);
  if ("error" in stepRow) return { ok: false, error: stepRow.error };
  if (!isPathInDir(filePath, attachmentDir(preLoadingId, stepRow.id))) {
    return { ok: false, error: "Invalid file path." };
  }

  const { error: insertError } = await admin.from("step_attachments").insert({
    pre_loading_step_id: stepRow.id,
    client_id: step === "shipping_docs" ? clientId : null,
    file_path: filePath,
    file_name: fileName,
    uploaded_by: session.userId,
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
      ...(step === "shipping_docs" && clientId ? { client_id: clientId } : {}),
    },
    userId: session.userId,
  });

  // O anexo pode ser o que faltava pra etapa fechar (ver lib/pl-step-autocomplete).
  // Documento novo é atualização da etapa: fecha ou regrava o Completed on.
  const completed = await autoCompletePlStep(admin, preLoadingId, step, session.userId, {
    refresh: true,
  });

  revalidatePath("/pre-loading/[id]", "page");
  if (completed) {
    revalidatePath("/pre-loading");
    revalidatePath("/todo");
    await broadcastPreLoadingPing();
  }
  return { ok: true };
}

export async function getPreLoadingAttachmentUrl(
  filePath: string,
  fileName?: string | null
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireFeature("pre_loading", "view");
  const admin = createAdminClient();

  // `{ download }` força Content-Disposition: attachment (baixa em vez de abrir
  // inline numa aba em branco).
  const { data, error } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(filePath, 60, { download: fileName ?? true });
  if (error || !data) return { ok: false, error: error?.message ?? "Failed to sign URL." };

  return { ok: true, url: data.signedUrl };
}

/**
 * Booking number de UM cliente do PL (21/10/2026) — PL com 2+ clientes tem um
 * Booking number por cliente; a etapa Booking fecha sozinha quando todos têm
 * (lib/pl-step-autocomplete). Vazio apaga o do cliente. Vai pro History da etapa
 * como "Cliente: número".
 */
export async function savePlClientBooking(
  preLoadingId: string,
  clientId: string,
  bookingNumber: string | null
): Promise<ActionResult> {
  const session = await requireFeature("pre_loading", "edit");
  const admin = createAdminClient();
  const value = bookingNumber?.trim() || null;
  if (value && value.length > 100) return { ok: false, error: "Booking number is too long." };

  const [{ data: existing, error: readError }, { data: client }] = await Promise.all([
    admin
      .from("pre_loading_client_bookings")
      .select("id, booking_number")
      .eq("pre_loading_id", preLoadingId)
      .eq("client_id", clientId)
      .maybeSingle(),
    admin.from("clients").select("name").eq("id", clientId).maybeSingle(),
  ]);
  if (readError) return { ok: false, error: readError.message };
  const previous = existing?.booking_number ?? null;
  if (previous === value) return { ok: true };

  const { error } = value
    ? await admin
        .from("pre_loading_client_bookings")
        .upsert(
          {
            pre_loading_id: preLoadingId,
            client_id: clientId,
            booking_number: value,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "pre_loading_id,client_id" }
        )
    : await admin.from("pre_loading_client_bookings").delete().eq("id", existing!.id);
  if (error) return { ok: false, error: error.message };

  const stepRow = await ensureStepId(admin, preLoadingId, "booking");
  if ("error" in stepRow) return { ok: false, error: stepRow.error };
  const label = client?.name ?? "Client";
  await writeStepLog(admin, {
    owner: { preLoadingStepId: stepRow.id },
    step: "booking",
    action: "update",
    changes: {
      booking_number: {
        from: previous ? `${label}: ${previous}` : null,
        to: value ? `${label}: ${value}` : null,
      },
    },
    userId: session.userId,
  });

  // Booking apagado reabre a etapa; preenchido fecha ou regrava o Completed on.
  const completed = await autoCompletePlStep(admin, preLoadingId, "booking", session.userId, {
    refresh: true,
  });

  revalidatePath("/pre-loading/[id]", "page");
  revalidatePath("/pre-loading");
  if (completed) {
    revalidatePath("/todo");
    await broadcastPreLoadingPing();
  }
  return { ok: true };
}

export async function deletePreLoadingStepAttachment(
  preLoadingId: string,
  attachmentId: string,
  filePath: string
): Promise<ActionResult> {
  const session = await requireFeature("pre_loading", "edit");
  const admin = createAdminClient();

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

  // Sem o documento a etapa pode deixar de valer: reabre (lib/pl-step-autocomplete).
  const reopened = removed
    ? await autoCompletePlStep(admin, preLoadingId, removed.step, session.userId, { refresh: true })
    : false;

  revalidatePath("/pre-loading/[id]", "page");
  if (reopened) {
    revalidatePath("/pre-loading");
    revalidatePath("/todo");
    await broadcastPreLoadingPing();
  }
  return { ok: true };
}


/**
 * "Confirm Shipping" do botão da tela. Validação + RPC atômica (sem split)
 * moram em domain/shipments/confirm.ts (o PATCH /api/shipments/{id} com
 * `status: "in_transit"` usa o mesmo caminho); aqui ficam a autorização, a
 * revalidação das telas e o envio ao GSS.
 */
export async function confirmShipping(
  preLoadingId: string,
  input: ConfirmShippingInput
): Promise<ActionResult> {
  const session = await requireFeature("pre_loading", "edit");
  const admin = createAdminClient();

  // A confirmação grava na etapa Loading date a data do popup (data real),
  // o Completed on (hoje) e o Signed by — lido antes pra entrar no log da etapa.
  const { data: loadingStep } = await admin
    .from("pre_loading_checklist_steps")
    .select("id, completed_on, event_date, signed_by_id")
    .eq("pre_loading_id", preLoadingId)
    .eq("step", "loading_date")
    .maybeSingle();

  const result = await confirmShippingRecord(admin, preLoadingId, input, session.userId);
  if (!result.ok) return { ok: false, error: result.error };

  if (loadingStep) {
    const today = todayIso();
    await writeStepLog(admin, {
      owner: { preLoadingStepId: loadingStep.id },
      step: "loading_date",
      action: "confirm_shipping",
      changes: {
        ...(loadingStep.event_date !== input.loading_date_completed_on
          ? { event_date: { from: loadingStep.event_date, to: input.loading_date_completed_on } }
          : {}),
        ...(loadingStep.completed_on !== today
          ? { completed_on: { from: loadingStep.completed_on, to: today } }
          : {}),
        ...(loadingStep.signed_by_id !== session.userId
          ? { signed_by_id: { from: loadingStep.signed_by_id, to: session.userId } }
          : {}),
      },
      userId: session.userId,
    });
  }
  // Estimated date + Responsible do Shipment que o popup gravou (22-23/10/2026).
  for (const c of result.estimate_changes) {
    await writeStepLog(admin, {
      owner: { preLoadingStepId: c.stepId },
      step: c.step,
      action: "confirm_shipping",
      changes: c.changes,
      userId: session.userId,
    });
  }

  revalidatePath("/pre-loading/[id]", "page");
  revalidatePath("/pre-loading");
  revalidatePath("/orders");
  // Confirmar o embarque CRIA o Shipment — a lista de Shipments precisa
  // refletir o novo registro (senão só aparece após um F5).
  revalidatePath("/shipments");
  // Realtime: novo embarque na lista Shipments E o PL sai da lista Pre-loading.
  await broadcastShipmentPing();
  await broadcastPreLoadingPing();
  if (result.changed_order_ids.length > 0) {
    await broadcastOrderStatusPing({ order_ids: result.changed_order_ids });
    sendOrderStatusToGss(result.changed_order_ids);
  }
  await scheduleClientNotificationDispatch();
  // A RPC grava o Loading date concluído → GSS.
  sendPlShipmentToGss(preLoadingId);
  return { ok: true };
}
