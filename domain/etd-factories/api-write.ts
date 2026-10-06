import "server-only";

import { z } from "zod";
import { revalidatePath } from "next/cache";

import { apiDay } from "@/lib/api-dates";
import { broadcastEtdPing } from "@/lib/etd-realtime";
import { ETD_SAVED_COLUMNS, writeEtdHistory, type EtdHistorySnapshot } from "@/lib/etd-history";
import type { createAdminClient } from "@/lib/supabase/admin";
import { fail, type WriteResult } from "@/domain/api/write-result";
import { EDITABLE_BATCH_STATUSES } from "@/domain/batches/api-schema";
import type { BatchStatus, TablesInsert } from "@/types/database";

import { getGssEtdEntry, type GssEtdRead } from "./gss-read";

/**
 * `PATCH /api/etd-factories/{id}` — o ETD de UMA linha Factory×Category, com
 * as regras das duas edições da tela (app/(dashboard)/orders/[id]/actions.ts:
 * edição rápida na linha + modal "ETD update"; docs §3.7.4):
 *
 *  - `initial_date` só grava enquanto vazia (a tela trava o campo depois);
 *  - o 1º `initial_date` copia para `current_date` (a data que a fábrica
 *    prometeu, não a de hoje);
 *  - `ready_parts` false→true é livre (grava `ready_date` = hoje);
 *  - CORREÇÃO — mudar um `current_date` já preenchido ou desmarcar
 *    `ready_parts` — exige `remarks` (o motivo, como no modal);
 *  - `current_date` não muda com o lote já embarcado (fora de In Negotiation/
 *    In Production);
 *  - toda mudança grava `etd_history` (source `api`).
 *
 * Mesmos nomes de campo do GET (`ready_parts` = `etd_info.ready`).
 */

type AdminClient = ReturnType<typeof createAdminClient>;
type UUID = string;

export const patchEtdSchema = z
  .strictObject({
    initial_date: apiDay.optional(),
    current_date: apiDay.optional(),
    ready_parts: z.boolean().optional(),
    remarks: z.string().trim().min(1, "remarks cannot be empty.").max(2000).optional(),
  })
  .refine(
    (v) => v.initial_date !== undefined || v.current_date !== undefined || v.ready_parts !== undefined,
    { message: "Send at least one of 'initial_date', 'current_date' or 'ready_parts'." }
  );

export type PatchEtdInput = z.infer<typeof patchEtdSchema>;

const today = () => new Date().toISOString().slice(0, 10);

export async function patchEtd(
  admin: AdminClient,
  actorId: string | null,
  lineId: UUID,
  input: PatchEtdInput
): Promise<WriteResult<GssEtdRead>> {
  const { data: line, error: lineError } = await admin
    .from("order_factory_category")
    .select("id, order_id, batch_id")
    .eq("id", lineId)
    .maybeSingle();
  if (lineError) return fail(500, lineError.message);
  if (!line) return fail(404, "Item not found.");

  const { data: existing, error: readError } = await admin
    .from("etd_info")
    .select("initial_date, current_date, ready, ready_date")
    .eq("order_factory_category_id", lineId)
    .maybeSingle();
  if (readError) return fail(500, readError.message);

  const update: TablesInsert<"etd_info"> = { order_factory_category_id: lineId };
  const changed: EtdHistorySnapshot["field"][] = [];
  let isCorrection = false;

  if (input.initial_date !== undefined && input.initial_date !== existing?.initial_date) {
    if (existing?.initial_date) {
      return fail(409, "Initial Date is locked once set. Change the current_date instead (with remarks).");
    }
    update.initial_date = input.initial_date;
    changed.push("initial_date");
    if (!existing?.current_date && input.current_date === undefined) {
      update.current_date = input.initial_date;
    }
  }

  if (input.current_date !== undefined && input.current_date !== existing?.current_date) {
    if (existing?.current_date) isCorrection = true;
    if (line.batch_id) {
      const { data: batch, error } = await admin
        .from("batches")
        .select("status")
        .eq("id", line.batch_id)
        .maybeSingle();
      if (error) return fail(500, error.message);
      if (batch && !(EDITABLE_BATCH_STATUSES as readonly BatchStatus[]).includes(batch.status)) {
        return fail(409, "The ETD can't be changed after the batch has shipped.");
      }
    }
    update.current_date = input.current_date;
    changed.push("current_date");
  }

  if (input.ready_parts !== undefined && input.ready_parts !== (existing?.ready ?? false)) {
    if (!input.ready_parts) isCorrection = true;
    update.ready = input.ready_parts;
    if (input.ready_parts && !existing?.ready_date) update.ready_date = today();
    changed.push("ready");
  }

  if (isCorrection && !input.remarks) {
    return fail(
      400,
      "remarks is required to correct an ETD (changing a filled current_date or unchecking ready_parts)."
    );
  }

  if (changed.length > 0) {
    if (input.remarks) update.remarks = input.remarks;
    const { data: saved, error } = await admin
      .from("etd_info")
      .upsert(update, { onConflict: "order_factory_category_id" })
      .select(ETD_SAVED_COLUMNS)
      .single();
    if (error || !saved) return fail(500, error?.message ?? "Failed to save the ETD.");

    const historyError = await writeEtdHistory(admin, saved, changed, "api", actorId);
    if (historyError) return fail(500, historyError);

    revalidatePath("/orders/[id]", "page");
    revalidatePath("/orders");
    revalidatePath("/etd-factories");
    await broadcastEtdPing({ order_ids: [line.order_id] });
  }

  const entry = await getGssEtdEntry(admin, lineId);
  if (!entry) return fail(500, "ETD was saved but could not be read back.");
  return { ok: true, status: 200, data: entry };
}
