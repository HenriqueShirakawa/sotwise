"use server";

import { revalidatePath } from "next/cache";

import { STEP_LABELS } from "@/lib/checklist";
import { isStepChecked, plStepFacts, validateStepDates } from "@/lib/checklist-completion";
import { requireFeature } from "@/lib/dal";
import { syncOrderStatus } from "@/lib/order-status";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BatchStatus, ChecklistStep } from "@/types/database";

type ActionResult = { ok: true } | { ok: false; error: string };

const DOCUMENTS_BUCKET = "order-documents";
const MAX_FILE_BYTES = 20 * 1024 * 1024;

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
  carrier_agent_id: string | null;
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

  revalidatePath(`/pre-loading/${preLoadingId}`);
  revalidatePath("/pre-loading");
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

export async function uploadPreLoadingStepAttachment(
  preLoadingId: string,
  step: ChecklistStep,
  formData: FormData
): Promise<ActionResult> {
  const session = await requireFeature("pre_loading", "edit");
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

  revalidatePath(`/pre-loading/${preLoadingId}`);
  return { ok: true };
}

export async function getPreLoadingAttachmentUrl(
  filePath: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireFeature("pre_loading", "view");
  const admin = createAdminClient();

  const { data, error } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(filePath, 60);
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

  revalidatePath(`/pre-loading/${preLoadingId}`);
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

/** Lote do pedido, no mínimo que o split consulta. */
type OrderBatchRow = {
  id: string;
  batch_number: string;
  status: BatchStatus;
  split_from_batch_id: string | null;
};

/** ".03" → 3. Sufixo não numérico conta como 0 (dado migrado do Bubble). */
function batchNum(batchNumber: string): number {
  const n = Number(String(batchNumber).replace(/^\./, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Status de lote que ainda aceita receber a produção que não carregou. Lote
 * embarcado/entregue não entra: a produção dele já foi.
 */
const MERGEABLE_STATUSES: BatchStatus[] = ["in_negotiation", "in_production"];

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
 * entrada Factory×Category, e roda o split por lote:
 *   - entradas Total ficam no lote, que vai para `in_transit`;
 *   - entradas None/Partial migram para o próximo lote do pedido que já esteja
 *     aberto (in negotiation / in production) ou, se não houver, para um lote
 *     novo (nasce `in_production`).
 * Por fim marca o PL como confirmado (sai da lista de Pre-loading).
 *
 * ⚠️ Sem transação (PostgREST não expõe uma pelo client): a criação do shipment
 * é primeiro e trava re-execução pelo unique em pre_loading_id. Uma falha no meio
 * do split exige limpeza manual — candidato a virar RPC/função no banco depois.
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
      "id, step, completed_on, consolidation_point_id, city_id, pol_id, carrier_agent_id, agent_brazil_id, agent_china_id, contact_brazil_id, contact_china_id, booking_number"
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

  const { data: batches } = await admin
    .from("batches")
    .select("id, order_id, batch_number")
    .in("id", batchIds);

  const { data: ofcRows } = await admin
    .from("order_factory_category")
    .select("id, batch_id, order_id")
    .in("batch_id", batchIds);

  const statusByOfc = new Map(input.statuses.map((s) => [s.ofc_id, s.status]));
  if ((ofcRows ?? []).some((o) => !statusByOfc.has(o.id))) {
    return { ok: false, error: "Set the loading status for every line." };
  }

  // 1. Shipment (1:1). O unique em pre_loading_id também barra confirmação dupla.
  const { error: shipErr } = await admin.from("shipments").insert({
    pre_loading_id: preLoadingId,
    container_number: input.container_number.trim(),
    carrier_id: input.carrier_id,
    shipment_model_id: input.shipment_model_id,
    leader_id: input.shipment_leader_id,
    signer_id: input.signer_id,
    estimated_date: input.estimated_date,
    status: "in_transit",
    created_by: session.userId,
  });
  if (shipErr) return { ok: false, error: shipErr.message };

  // 2. loading_status por entrada.
  for (const value of ["total", "partial", "none"] as const) {
    const ids = (ofcRows ?? []).filter((o) => statusByOfc.get(o.id) === value).map((o) => o.id);
    if (ids.length) {
      const { error } = await admin
        .from("order_factory_category")
        .update({ loading_status: value })
        .in("id", ids);
      if (error) return { ok: false, error: error.message };
    }
  }

  // 3. Split: agrupa as entradas não-Total por lote de origem.
  const nonTotalByBatch = new Map<string, string[]>();
  for (const o of ofcRows ?? []) {
    if (!o.batch_id || statusByOfc.get(o.id) === "total") continue;
    const arr = nonTotalByBatch.get(o.batch_id) ?? [];
    arr.push(o.id);
    nonTotalByBatch.set(o.batch_id, arr);
  }

  // Lotes existentes de cada pedido: servem para numerar o lote novo e para
  // achar um lote seguinte que já esteja aberto.
  const batchesByOrder = new Map<string, OrderBatchRow[]>();
  const nextNumByOrder = new Map<string, number>();
  for (const orderId of new Set((batches ?? []).map((b) => b.order_id))) {
    const { data: all } = await admin
      .from("batches")
      .select("id, batch_number, status, split_from_batch_id")
      .eq("order_id", orderId)
      .returns<OrderBatchRow[]>();
    batchesByOrder.set(orderId, all ?? []);
    nextNumByOrder.set(
      orderId,
      (all ?? []).reduce((m, b) => (batchNum(b.batch_number) > m ? batchNum(b.batch_number) : m), 0)
    );
  }

  const plBatchIdSet = new Set(batchIds);

  for (const batch of batches ?? []) {
    const toMove = nonTotalByBatch.get(batch.id) ?? [];
    if (toMove.length) {
      // Destino das linhas que não carregaram: o PRÓXIMO lote do pedido que já
      // exista e ainda esteja aberto (in negotiation / in production). Só quando
      // não há nenhum é que nasce um lote novo — antes criava sempre, e um
      // pedido com o lote seguinte já planejado terminava com dois lotes
      // concorrentes para a mesma produção.
      const target = (batchesByOrder.get(batch.order_id) ?? [])
        .filter(
          (b) =>
            !plBatchIdSet.has(b.id) &&
            MERGEABLE_STATUSES.includes(b.status) &&
            batchNum(b.batch_number) > batchNum(batch.batch_number)
        )
        .sort((a, b) => batchNum(a.batch_number) - batchNum(b.batch_number))[0];

      let targetId: string;
      if (target) {
        targetId = target.id;
        // Sem isso o "View parts" do embarque perde as linhas que saíram: ele
        // acha o destino subindo por `split_from_batch_id`. Só preenche quando
        // está vazio — a origem já registrada de um lote não se sobrescreve.
        if (!target.split_from_batch_id) {
          const { error: lnErr } = await admin
            .from("batches")
            .update({ split_from_batch_id: batch.id })
            .eq("id", target.id);
          if (lnErr) return { ok: false, error: lnErr.message };
          target.split_from_batch_id = batch.id;
        }
      } else {
        const next = (nextNumByOrder.get(batch.order_id) ?? 0) + 1;
        nextNumByOrder.set(batch.order_id, next);
        const { data: newBatch, error: nbErr } = await admin
          .from("batches")
          .insert({
            order_id: batch.order_id,
            batch_number: "." + String(next).padStart(2, "0"),
            status: "in_production",
            split_from_batch_id: batch.id,
          })
          .select("id")
          .single();
        if (nbErr || !newBatch)
          return { ok: false, error: nbErr?.message ?? "Failed to split batch." };
        targetId = newBatch.id;
        batchesByOrder.get(batch.order_id)?.push({
          id: newBatch.id,
          batch_number: "." + String(next).padStart(2, "0"),
          status: "in_production",
          split_from_batch_id: batch.id,
        });
      }

      const { error: mvErr } = await admin
        .from("order_factory_category")
        .update({ batch_id: targetId })
        .in("id", toMove);
      if (mvErr) return { ok: false, error: mvErr.message };
    }
    // 4. O lote que carregou vai para in_transit.
    const { error: stErr } = await admin.from("batches").update({ status: "in_transit" }).eq("id", batch.id);
    if (stErr) return { ok: false, error: stErr.message };
  }

  // Embarque muda a fase dos lotes (e o split pode ter criado outros): as
  // Orders viram Shipped / Partially Shipped conforme o rollup (§3.7.1).
  const statusError = await syncOrderStatus(
    admin,
    (batches ?? []).map((b) => b.order_id)
  );
  if (statusError) return { ok: false, error: statusError };

  // 5. Marca o PL como confirmado + grava seal/leader do embarque.
  const { error: plUpdErr } = await admin
    .from("pre_loadings")
    .update({
      seal_number: input.seal_number.trim(),
      leader_id: input.preloading_leader_id,
      shipping_confirmed_at: new Date().toISOString(),
    })
    .eq("id", preLoadingId);
  if (plUpdErr) return { ok: false, error: plUpdErr.message };

  revalidatePath(`/pre-loading/${preLoadingId}`);
  revalidatePath("/pre-loading");
  revalidatePath("/orders");
  return { ok: true };
}
