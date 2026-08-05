"use server";

import { revalidatePath } from "next/cache";

import { verifySession } from "@/lib/dal";
import { PRELOADING_STEPS, SHIPMENT_STEPS } from "@/lib/checklist";
import { syncOrderStatusForBatches } from "@/lib/order-status";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  preLoadingSchema,
  type ActionResult,
  type CreateResult,
  type PreLoadingInput,
} from "@/domain/pre-loadings/schema";

const PATH = "/pre-loading";
const PAGE = 1000;

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Próximo `pl_number`: o maior número existente + 1. Os PLs importados do
 * Bubble guardam o número puro ("1367"), então a ordenação tem de ser numérica
 * — o `order()` do Postgres em coluna text ordenaria "999" > "1000". Varre a
 * coluna inteira (uma coluna só, barato) incluindo os soft-deleted, porque o
 * número é unique no banco e não pode ser reaproveitado.
 */
async function nextPlNumber(admin: Admin): Promise<string> {
  let max = 0;
  for (let from = 0; ; from += PAGE) {
    const { data } = await admin
      .from("pre_loadings")
      .select("pl_number")
      .range(from, from + PAGE - 1);
    const chunk = data ?? [];
    for (const r of chunk) {
      const n = Number(r.pl_number);
      if (Number.isFinite(n) && n > max) max = n;
    }
    if (chunk.length < PAGE) break;
  }
  return String(max + 1);
}

/** Aplica clientes/lotes de um PL, refletindo o status dos lotes envolvidos. */
async function syncRelations(
  admin: Admin,
  preLoadingId: string,
  clientIds: string[],
  batchIds: string[]
): Promise<string | null> {
  // Clientes: troca o conjunto inteiro (junção sem colunas extras).
  const delClients = await admin
    .from("pre_loading_clients")
    .delete()
    .eq("pre_loading_id", preLoadingId);
  if (delClients.error) return delClients.error.message;

  if (clientIds.length) {
    const insClients = await admin
      .from("pre_loading_clients")
      .insert(clientIds.map((client_id) => ({ pre_loading_id: preLoadingId, client_id })));
    if (insClients.error) return insClients.error.message;
  }

  // Lotes: descobre o que entrou e o que saiu pra mexer só no status desses.
  const { data: current, error: curErr } = await admin
    .from("pre_loading_batches")
    .select("batch_id")
    .eq("pre_loading_id", preLoadingId);
  if (curErr) return curErr.message;

  const before = new Set((current ?? []).map((b) => b.batch_id));
  const after = new Set(batchIds);
  const added = batchIds.filter((id) => !before.has(id));
  const removed = [...before].filter((id) => !after.has(id));

  if (removed.length) {
    const del = await admin
      .from("pre_loading_batches")
      .delete()
      .eq("pre_loading_id", preLoadingId)
      .in("batch_id", removed);
    if (del.error) return del.error.message;

    // Lote tirado do PL volta pra produção (ver docs §3.9.1).
    const back = await admin
      .from("batches")
      .update({ status: "in_production" })
      .in("id", removed);
    if (back.error) return back.error.message;
  }

  if (added.length) {
    const ins = await admin
      .from("pre_loading_batches")
      .insert(added.map((batch_id) => ({ pre_loading_id: preLoadingId, batch_id })));
    if (ins.error) return ins.error.message;

    // Lote selecionado passa a 'preloading' — é o que o tira da lista de
    // seleção dos outros PLs (docs/regras_de_negocio.md §3.9).
    const fwd = await admin
      .from("batches")
      .update({ status: "preloading" })
      .in("id", added);
    if (fwd.error) return fwd.error.message;
  }

  // Entrar ou sair do PL muda a fase dos lotes: as Orders envolvidas passam a
  // Pre-Loading / Partially Preloading (ou voltam) conforme o rollup (§3.7.1).
  const touched = [...added, ...removed];
  if (touched.length) {
    const statusError = await syncOrderStatusForBatches(admin, touched);
    if (statusError) return statusError;
  }

  return null;
}

export async function createPreLoading(input: PreLoadingInput): Promise<CreateResult> {
  const session = await verifySession();

  const parsed = preLoadingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const admin = createAdminClient();

  // O número é calculado aqui (não no cliente) porque `pl_number` é unique.
  // Numa colisão por concorrência, recalcula e tenta de novo uma vez.
  let created: { id: string } | null = null;
  let lastError = "";
  for (let attempt = 0; attempt < 2 && !created; attempt++) {
    const { data, error } = await admin
      .from("pre_loadings")
      .insert({
        pl_number: await nextPlNumber(admin),
        client_reference: d.client_reference,
        pod_id: d.pod_id,
        responsible_signer_id: d.responsible_signer_id,
        leader_id: d.leader_id,
        created_by: session.userId,
      })
      .select("id")
      .single();
    if (error) {
      lastError = error.code === "23505" ? "PL number already taken, try again." : error.message;
      if (error.code !== "23505") break;
      continue;
    }
    created = data;
  }
  if (!created) return { ok: false, error: lastError || "Could not create pre-loading." };
  const preLoadingId = created.id;

  // As 14 etapas do checklist único (7 do Pre-loading + 7 do Shipment) nascem
  // junto com o PL, como já acontece com as 10 etapas da Order em
  // orders/actions.ts. Sem esse seed as linhas só existiriam a partir do
  // primeiro save de cada etapa, e a To do list — que lê a tabela direto — não
  // enxergaria as etapas nunca tocadas. Os PLs vindos do Bubble já trouxeram as
  // linhas na migração.
  const { error: stepsError } = await admin
    .from("pre_loading_checklist_steps")
    .insert(
      [...PRELOADING_STEPS, ...SHIPMENT_STEPS].map((step) => ({
        pre_loading_id: preLoadingId,
        step,
      }))
    );
  if (stepsError) return { ok: false, error: stepsError.message };

  const relError = await syncRelations(admin, preLoadingId, d.client_ids, d.batch_ids);
  if (relError) return { ok: false, error: relError };

  revalidatePath(PATH);
  revalidatePath("/orders"); // os lotes selecionados mudaram de fase
  return { ok: true, id: preLoadingId };
}

export async function updatePreLoading(
  id: string,
  input: PreLoadingInput
): Promise<ActionResult> {
  await verifySession();

  const parsed = preLoadingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const admin = createAdminClient();
  // pl_number e created_date são imutáveis (auto-gerados) — não entram no update.
  const { error } = await admin
    .from("pre_loadings")
    .update({
      client_reference: d.client_reference,
      pod_id: d.pod_id,
      responsible_signer_id: d.responsible_signer_id,
      leader_id: d.leader_id,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  const relError = await syncRelations(admin, id, d.client_ids, d.batch_ids);
  if (relError) return { ok: false, error: relError };

  revalidatePath(PATH);
  revalidatePath("/orders"); // tirar lote do PL pode mexer no status da Order
  return { ok: true };
}

export async function deletePreLoading(id: string): Promise<ActionResult> {
  await verifySession();

  const admin = createAdminClient();
  const { error } = await admin
    .from("pre_loadings")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  // Libera os lotes de volta pra produção, senão ficariam presos em
  // 'preloading' e invisíveis na seleção de qualquer outro PL. Os vínculos em
  // pre_loading_batches ficam — o soft delete é reversível por um admin.
  const { data: links } = await admin
    .from("pre_loading_batches")
    .select("batch_id")
    .eq("pre_loading_id", id);
  const batchIds = (links ?? []).map((l) => l.batch_id);
  if (batchIds.length) {
    await admin.from("batches").update({ status: "in_production" }).in("id", batchIds);
    await syncOrderStatusForBatches(admin, batchIds);
  }

  revalidatePath(PATH);
  revalidatePath("/orders");
  return { ok: true };
}
