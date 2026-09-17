"use server";

import { revalidatePath } from "next/cache";

import { STEP_LABELS } from "@/lib/checklist";
import { isStepChecked, plStepFacts, validateStepDates } from "@/lib/checklist-completion";
import { DOCUMENTS_BUCKET, type UploadTicket } from "@/lib/attachments";
import { isPathInDir, issueUploadTicket } from "@/lib/attachments-server";
import { scheduleClientNotificationDispatch } from "@/domain/client/notifications";
import { requireFeature } from "@/lib/dal";
import { broadcastOrderStatusPing } from "@/lib/orders-realtime";
import { broadcastPreLoadingPing } from "@/lib/preloading-realtime";
import { broadcastShipmentPing } from "@/lib/shipments-realtime";
import { createAdminClient } from "@/lib/supabase/admin";
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
}>;

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
    .select("id, estimated_date, completed_on")
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

  const { error } = existing
    ? await admin.from("pre_loading_checklist_steps").update(values).eq("id", existing.id)
    : await admin
        .from("pre_loading_checklist_steps")
        .insert({ pre_loading_id: preLoadingId, step, ...values });
  if (error) return { ok: false, error: error.message };

  // Pelo padrão da rota, não por valor: a página vive em duas URLs (pl_number
  // bonito e UUID antigo) — isto invalida as duas de uma vez.
  revalidatePath("/pre-loading/[id]", "page");
  revalidatePath("/pre-loading");
  // Atribuir/trocar responsável ou concluir/reabrir etapa muda a To do list.
  revalidatePath("/todo");
  // Realtime: colunas da lista Pre-loading (datas/booking) mudaram.
  await broadcastPreLoadingPing();
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
  fileName: string
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
    file_path: filePath,
    file_name: fileName,
    uploaded_by: session.userId,
  });
  if (insertError) {
    await admin.storage.from(DOCUMENTS_BUCKET).remove([filePath]);
    return { ok: false, error: insertError.message };
  }

  revalidatePath("/pre-loading/[id]", "page");
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

export async function deletePreLoadingStepAttachment(
  preLoadingId: string,
  attachmentId: string,
  filePath: string
): Promise<ActionResult> {
  await requireFeature("pre_loading", "edit");
  const admin = createAdminClient();

  const { error } = await admin.from("step_attachments").delete().eq("id", attachmentId);
  if (error) return { ok: false, error: error.message };

  await admin.storage.from(DOCUMENTS_BUCKET).remove([filePath]);

  revalidatePath("/pre-loading/[id]", "page");
  return { ok: true };
}

/** As 7 etapas da fase pre-loading — todas precisam estar concluídas p/ confirmar. */
const PL_STEPS: ChecklistStep[] = [
  "consolidation_point",
  "city",
  "port_of_loading",
  "shipping_docs",
  "agents",
  "booking",
  "loading_date",
];

export type ConfirmShippingInput = {
  container_number: string;
  seal_number: string;
  estimated_date: string; // yyyy-mm-dd
  shipment_leader_id: string;
  preloading_leader_id: string;
  carrier_id: string;
  shipment_model_id: string;
  signer_id: string;
  /** loading_status por entrada order_factory_category (None/Partial/Total). */
  statuses: { ofc_id: string; status: "none" | "partial" | "total" }[];
};

/**
 * "Confirm Shipping": converte um Pre-loading concluído num Shipment (regra
 * 3.9.6 + split 3.7.2). Cria o shipment 1:1, grava o loading_status de cada
 * entrada Factory×Category (e o snapshot do que este embarque carregou, em
 * shipment_loaded_lines), e roda o split por lote:
 *   - entradas Total ficam no lote, que vai para `in_transit`;
 *   - entradas None/Partial migram para o próximo lote do pedido que já esteja
 *     aberto (in negotiation / in production) ou, se não houver, para um lote
 *     novo (nasce `in_production`).
 * Por fim marca o PL como confirmado (sai da lista de Pre-loading).
 *
 * A validação (campos, checklist, cobertura de status) roda aqui; a escrita em
 * si (shipment -> split -> confirma o PL) é uma chamada RPC atômica —
 * `confirm_shipping`, ver supabase/migrations/20260917120000_shipping_atomic.sql.
 * Uma falha no meio desfaz tudo (era o ponto fraco desta função antes: shipment
 * criado mas split/PL pela metade — precisou de limpeza manual em 17/09/2026).
 */
export async function confirmShipping(
  preLoadingId: string,
  input: ConfirmShippingInput
): Promise<ActionResult> {
  const session = await requireFeature("pre_loading", "edit");
  const admin = createAdminClient();

  const required = [
    input.container_number,
    input.seal_number,
    input.estimated_date,
    input.shipment_leader_id,
    input.preloading_leader_id,
    input.carrier_id,
    input.shipment_model_id,
    input.signer_id,
  ];
  if (required.some((v) => !v || !String(v).trim())) {
    return { ok: false, error: "Fill in all required fields." };
  }
  const VALID = new Set(["none", "partial", "total"]);
  if (input.statuses.some((s) => !VALID.has(s.status))) {
    return { ok: false, error: "Each line must be None, Partial or Total." };
  }

  const { data: pl, error: plErr } = await admin
    .from("pre_loadings")
    .select("id, shipping_confirmed_at")
    .eq("id", preLoadingId)
    .is("deleted_at", null)
    .maybeSingle();
  if (plErr) return { ok: false, error: plErr.message };
  if (!pl) return { ok: false, error: "Pre-loading not found." };
  if (pl.shipping_confirmed_at) return { ok: false, error: "This Pre-loading was already shipped." };

  // Reforça no servidor a trava do botão: as 7 etapas concluídas — pela regra
  // completa (data + documento/cadastro/booking), não só pelo "Completed on".
  const { data: steps } = await admin
    .from("pre_loading_checklist_steps")
    .select(
      "id, step, completed_on, consolidation_point_id, city_id, pol_id, carrier_id, agent_brazil_id, agent_china_id, contact_brazil_id, contact_china_id, booking_number"
    )
    .eq("pre_loading_id", preLoadingId);

  const stepIds = (steps ?? []).map((s) => s.id);
  const { data: attachments } = stepIds.length
    ? await admin
        .from("step_attachments")
        .select("pre_loading_step_id")
        .in("pre_loading_step_id", stepIds)
    : { data: [] };
  const attachmentCount = new Map<string, number>();
  for (const a of attachments ?? []) {
    if (!a.pre_loading_step_id) continue;
    attachmentCount.set(
      a.pre_loading_step_id,
      (attachmentCount.get(a.pre_loading_step_id) ?? 0) + 1
    );
  }

  const byStep = new Map((steps ?? []).map((s) => [s.step, s]));

  // Contatos dos agentes escolhidos: sem nenhum cadastrado, Contact Brazil /
  // Contact China deixam de ser exigência da etapa Agents (mesma regra da tela).
  const agentsStep = byStep.get("agents");
  const agentIds = [agentsStep?.agent_brazil_id, agentsStep?.agent_china_id].filter(
    (id): id is string => !!id
  );
  const { data: agentContacts } = agentIds.length
    ? await admin.from("agent_contacts").select("agent_id").in("agent_id", agentIds)
    : { data: [] };
  const contactCountByAgent: Record<string, number> = {};
  for (const ac of agentContacts ?? []) {
    contactCountByAgent[ac.agent_id] = (contactCountByAgent[ac.agent_id] ?? 0) + 1;
  }

  const pending = PL_STEPS.filter((step) => {
    const s = byStep.get(step);
    if (!s) return true;
    return !isStepChecked(
      step,
      plStepFacts(s, attachmentCount.get(s.id) ?? 0, contactCountByAgent)
    );
  });
  if (pending.length > 0) {
    return {
      ok: false,
      error: `Complete all checklist steps before shipping — still open: ${pending
        .map((s) => STEP_LABELS[s])
        .join(", ")}.`,
    };
  }

  const { data: plBatches } = await admin
    .from("pre_loading_batches")
    .select("batch_id")
    .eq("pre_loading_id", preLoadingId);
  const batchIds = (plBatches ?? []).map((b) => b.batch_id);
  if (batchIds.length === 0) return { ok: false, error: "This Pre-loading has no batches." };

  const { data: ofcRows } = await admin
    .from("order_factory_category")
    .select("id, batch_id, order_id")
    .in("batch_id", batchIds);

  const statusByOfc = new Map(input.statuses.map((s) => [s.ofc_id, s.status]));
  if ((ofcRows ?? []).some((o) => !statusByOfc.has(o.id))) {
    return { ok: false, error: "Set the loading status for every line." };
  }

  // Shipment + loading_status + snapshot + split + confirma o PL — tudo numa
  // função de banco (RPC), rodando como uma única transação: uma falha no
  // meio desfaz tudo, em vez de deixar o shipment órfão que o comentário
  // antigo desta função alertava. Ver supabase/migrations/20260917120000_shipping_atomic.sql.
  const { data: rpcResult, error: rpcError } = await admin.rpc("confirm_shipping", {
    p_pre_loading_id: preLoadingId,
    p_container_number: input.container_number.trim(),
    p_seal_number: input.seal_number.trim(),
    p_estimated_date: input.estimated_date,
    p_shipment_leader_id: input.shipment_leader_id,
    p_preloading_leader_id: input.preloading_leader_id,
    p_carrier_id: input.carrier_id,
    p_shipment_model_id: input.shipment_model_id,
    p_signer_id: input.signer_id,
    p_created_by: session.userId,
    p_statuses: input.statuses,
  });
  if (rpcError) return { ok: false, error: rpcError.message };

  revalidatePath("/pre-loading/[id]", "page");
  revalidatePath("/pre-loading");
  revalidatePath("/orders");
  // Confirmar o embarque CRIA o Shipment — a lista de Shipments precisa
  // refletir o novo registro (senão só aparece após um F5).
  revalidatePath("/shipments");
  // Realtime: novo embarque na lista Shipments E o PL sai da lista Pre-loading.
  await broadcastShipmentPing();
  await broadcastPreLoadingPing();
  const changedOrderIds = rpcResult?.changed_order_ids ?? [];
  if (changedOrderIds.length > 0) {
    await broadcastOrderStatusPing({ order_ids: changedOrderIds });
  }
  await scheduleClientNotificationDispatch();
  return { ok: true };
}
