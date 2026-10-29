"use server";

import { revalidatePath } from "next/cache";

import { requireFeature } from "@/lib/dal";
import { broadcastPreLoadingPing } from "@/lib/preloading-realtime";
import { createAdminClient } from "@/lib/supabase/admin";
import { scheduleGssOutboundDispatch, sendBatchStatusToGss, sendPlShipmentToGss } from "@/lib/gss/outbound/schedule";
import { loadSelectableBatchOptions } from "@/domain/pre-loadings/selectable-batches";
import {
  createPreLoadingRecord,
  deletePreLoadingRecord,
  nextPlNumber,
  syncPreLoadingRelations,
} from "@/domain/pre-loadings/write";
import {
  preLoadingSchema,
  type ActionResult,
  type CreateResult,
  type PreLoadingInput,
} from "@/domain/pre-loadings/schema";

import type { BatchOption } from "./pre-loading-form-modal";

const PATH = "/pre-loading";

/**
 * Lista atual de lotes selecionáveis, buscada na hora. O modal Create/Edit
 * Pre-loading chama isto ao abrir para não depender da prop do render inicial
 * da página — um lote criado/movido pra Production com a página já aberta
 * aparece sem F5.
 */
export async function getSelectableBatchOptions(): Promise<BatchOption[]> {
  await requireFeature("pre_loading");
  const admin = createAdminClient();
  return loadSelectableBatchOptions(admin);
}

/** Próximo nº de PL (só exibição no modal; o número real sai no insert). */
export async function getNextPlNumber(): Promise<string> {
  await requireFeature("pre_loading");
  return nextPlNumber(createAdminClient());
}

export async function createPreLoading(input: PreLoadingInput): Promise<CreateResult> {
  const session = await requireFeature("pre_loading", "create");

  const parsed = preLoadingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const admin = createAdminClient();

  // Número (unique, com 1 retentativa), as 14 etapas do checklist e os vínculos
  // de clientes/lotes — mesmo caminho do POST /api/shipments
  // (domain/pre-loadings/write.ts).
  const created = await createPreLoadingRecord(admin, {
    client_reference: d.client_reference,
    pod_id: d.pod_id,
    responsible_signer_id: d.responsible_signer_id,
    leader_id: d.leader_id,
    client_ids: d.client_ids,
    batch_ids: d.batch_ids,
    created_by: session.userId,
  });
  if (!created.ok) return { ok: false, error: created.error };

  revalidatePath(PATH);
  revalidatePath("/orders"); // os lotes selecionados mudaram de fase
  await broadcastPreLoadingPing(); // lista Pre-loading aberta reflete o PL novo
  // Cria o PL no GSS (POST /shipments/; se já existir lá, vira PATCH). A fila
  // só age com migration + chave.
  sendPlShipmentToGss(created.id, { create: true });
  await scheduleGssOutboundDispatch();
  return { ok: true, id: created.id, pl_number: created.pl_number };
}

export async function updatePreLoading(
  id: string,
  input: PreLoadingInput
): Promise<ActionResult> {
  const session = await requireFeature("pre_loading", "edit");

  const parsed = preLoadingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const admin = createAdminClient();
  // Lotes de antes: os que saírem voltam a In Production e o GSS precisa saber.
  const { data: beforeLinks } = await admin
    .from("pre_loading_batches")
    .select("batch_id")
    .eq("pre_loading_id", id);
  const removedBatchIds = (beforeLinks ?? []).map((l) => l.batch_id).filter((b) => !d.batch_ids.includes(b));
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

  const relError = await syncPreLoadingRelations(
    admin,
    id,
    d.client_ids,
    d.batch_ids,
    session.userId
  );
  if (relError) return { ok: false, error: relError };

  revalidatePath(PATH);
  revalidatePath("/orders"); // tirar lote do PL pode mexer no status da Order
  await broadcastPreLoadingPing();
  // Lotes incluídos/retirados do PL → GSS (batch_ids + status preloading, e o
  // status de cada lote, inclusive dos que saíram).
  sendPlShipmentToGss(id, { removedBatchIds });
  return { ok: true };
}

export async function deletePreLoading(id: string): Promise<ActionResult> {
  const session = await requireFeature("pre_loading", "delete");

  // Hard delete em cascata (vínculos, checklist, Shipment 1:1); os lotes voltam
  // pra produção — ver domain/pre-loadings/write.ts.
  const admin = createAdminClient();
  const { data: links } = await admin.from("pre_loading_batches").select("batch_id").eq("pre_loading_id", id);
  const deleteError = await deletePreLoadingRecord(admin, id, session.userId);
  if (deleteError) return { ok: false, error: deleteError };
  // Lotes voltaram a In Production → GSS.
  sendBatchStatusToGss({ batchIds: (links ?? []).map((l) => l.batch_id) });

  revalidatePath(PATH);
  revalidatePath("/orders");
  await broadcastPreLoadingPing(); // PL excluído sai da lista na hora
  return { ok: true };
}
