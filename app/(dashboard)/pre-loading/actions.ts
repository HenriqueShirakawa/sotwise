"use server";

import { revalidatePath } from "next/cache";

import { requireFeature } from "@/lib/dal";
import { broadcastPreLoadingPing } from "@/lib/preloading-realtime";
import { createAdminClient } from "@/lib/supabase/admin";
import { scheduleGssOutboundDispatch } from "@/lib/gss/outbound/schedule";
import { loadSelectableBatchOptions } from "@/domain/pre-loadings/selectable-batches";
import {
  createPreLoadingRecord,
  deletePreLoadingRecord,
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
  // Create PL cria o PL no GSS (o trigger enfileira; isto só apressa o envio).
  await scheduleGssOutboundDispatch();
  return { ok: true, id: created.id, pl_number: created.pl_number };
}

export async function updatePreLoading(
  id: string,
  input: PreLoadingInput
): Promise<ActionResult> {
  await requireFeature("pre_loading", "edit");

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

  const relError = await syncPreLoadingRelations(admin, id, d.client_ids, d.batch_ids);
  if (relError) return { ok: false, error: relError };

  revalidatePath(PATH);
  revalidatePath("/orders"); // tirar lote do PL pode mexer no status da Order
  await broadcastPreLoadingPing();
  return { ok: true };
}

export async function deletePreLoading(id: string): Promise<ActionResult> {
  await requireFeature("pre_loading", "delete");

  // Hard delete em cascata (vínculos, checklist, Shipment 1:1); os lotes voltam
  // pra produção — ver domain/pre-loadings/write.ts.
  const deleteError = await deletePreLoadingRecord(createAdminClient(), id);
  if (deleteError) return { ok: false, error: deleteError };

  revalidatePath(PATH);
  revalidatePath("/orders");
  await broadcastPreLoadingPing(); // PL excluído sai da lista na hora
  return { ok: true };
}
