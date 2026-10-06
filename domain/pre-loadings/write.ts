import { PRELOADING_STEPS, SHIPMENT_STEPS } from "@/lib/checklist";
import { syncOrderStatusForBatches } from "@/lib/order-status";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Escrita de PRE-LOADING compartilhada entre as telas
 * (app/(dashboard)/pre-loading/actions.ts) e a API (/api/shipments,
 * domain/shipments/api-write.ts). Sem autorização nem revalidação — isso fica
 * com quem chama.
 */

type Admin = ReturnType<typeof createAdminClient>;

const PAGE = 1000;

/**
 * Próximo `pl_number`: o maior número existente + 1. Os PLs importados do
 * Bubble guardam o número puro ("1367"), então a ordenação tem de ser numérica
 * — o `order()` do Postgres em coluna text ordenaria "999" > "1000". Varre a
 * coluna inteira (uma coluna só, barato) incluindo os soft-deleted, porque o
 * número é unique no banco e não pode ser reaproveitado.
 */
export async function nextPlNumber(admin: Admin): Promise<string> {
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
export async function syncPreLoadingRelations(
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

export type PreLoadingHeader = {
  client_reference: string;
  pod_id: string;
  responsible_signer_id: string | null;
  leader_id: string;
};

/**
 * Cria o PL: número (unique — numa colisão por concorrência recalcula e tenta
 * de novo uma vez), as 14 etapas do checklist e os vínculos de clientes/lotes.
 */
export async function createPreLoadingRecord(
  admin: Admin,
  input: PreLoadingHeader & {
    client_ids: string[];
    batch_ids: string[];
    created_by: string | null;
    gss_id?: string | null;
  }
): Promise<{ ok: true; id: string; pl_number: string } | { ok: false; error: string; conflict?: boolean }> {
  let created: { id: string; pl_number: string } | null = null;
  let lastError = "";
  for (let attempt = 0; attempt < 2 && !created; attempt++) {
    const { data, error } = await admin
      .from("pre_loadings")
      .insert({
        pl_number: await nextPlNumber(admin),
        client_reference: input.client_reference,
        pod_id: input.pod_id,
        responsible_signer_id: input.responsible_signer_id,
        leader_id: input.leader_id,
        created_by: input.created_by,
        ...(input.gss_id ? { gss_id: input.gss_id } : {}),
      })
      .select("id, pl_number")
      .single();
    if (error) {
      lastError = error.code === "23505" ? "PL number already taken, try again." : error.message;
      if (error.code !== "23505") break;
      continue;
    }
    created = data;
  }
  if (!created) return { ok: false, error: lastError || "Could not create pre-loading.", conflict: true };
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

  const relError = await syncPreLoadingRelations(admin, preLoadingId, input.client_ids, input.batch_ids);
  if (relError) return { ok: false, error: relError };

  return { ok: true, id: preLoadingId, pl_number: created.pl_number };
}

/**
 * Hard delete do PL: em cascata vão os vínculos (clients/batches/checklist) e o
 * Shipment 1:1. Os lotes não são apagados (pertencem às orders); voltam pra
 * produção e o status da Order é recalculado.
 */
export async function deletePreLoadingRecord(admin: Admin, id: string): Promise<string | null> {
  // Captura os lotes ANTES de apagar — o hard delete leva junto os vínculos em
  // pre_loading_batches (ON DELETE CASCADE, migration 20260805130000).
  const { data: links } = await admin
    .from("pre_loading_batches")
    .select("batch_id")
    .eq("pre_loading_id", id);
  const batchIds = (links ?? []).map((l) => l.batch_id);

  const { error } = await admin.from("pre_loadings").delete().eq("id", id);
  if (error) return error.message;

  if (batchIds.length) {
    await admin.from("batches").update({ status: "in_production" }).in("id", batchIds);
    await syncOrderStatusForBatches(admin, batchIds);
  }
  return null;
}
