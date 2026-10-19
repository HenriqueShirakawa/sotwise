/**
 * Status do lote do SOTWISE → `PATCH /v1/orders/{order}/batch/{n}/` do GSS
 * (regras_de_negocio §6.13, pedido do usuário em 19/10/2026).
 *
 * Quando o status muda aqui, o GSS recebe `{status: "<code>"}` — o `code` do
 * catálogo `GET /orders/batch/status/` — e devolve o NOME no GET/PATCH:
 *
 *   in_negotiation → negotiation → "In Negotiation"  (dropdown do lote)
 *   in_production  → production  → "In Production"   (dropdown, Deposit Payment, regra do Gustavo)
 *   preloading     → pre         → "Pre Shipment"    (Create/Edit PL)
 *   in_transit     → transit     → "In Transit"      (Confirm Shipping)
 *   delivered      → delivered   → "Delivered"       (etapa Delivered)
 *   canceled       → canceled    → "Canceled"
 *
 * Histórico: até 19/10 o GSS tratava `status` como readOnly (200 e ignorava);
 * liberado pelo time do GSS em 20/10 — só aceita o code (id dá 400 "Expected a
 * status code string."). `ignored` segue no log se ele voltar a descartar.
 *
 * Por Order: lista os lotes dela no GSS (`GET /orders/{order}/batch/`), casa
 * pelo `batch_id` (= nosso `batches.gss_id`) e só faz PATCH do que difere —
 * lote que não veio do GSS não vai. Usa o `batch_number` DO GSS na rota.
 *
 * Sem `server-only` e com imports relativos, como os outros envios.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { BatchStatus, Database } from "../../../types/database";
import { gssRequest, type GssWriteResult } from "../client";

type DB = SupabaseClient<Database>;

export const GSS_BATCH_STATUS: Record<BatchStatus, string> = {
  in_negotiation: "negotiation",
  in_production: "production",
  preloading: "pre",
  in_transit: "transit",
  delivered: "delivered",
  canceled: "canceled",
};

/** Nome que o GSS devolve para cada code (catálogo conferido em 20/10). */
const GSS_BATCH_STATUS_NAME: Record<string, string> = {
  negotiation: "in negotiation",
  production: "in production",
  pre: "pre shipment",
  transit: "in transit",
  delivered: "delivered",
  canceled: "canceled",
};

type GssOrderBatch = { batch_id: number; batch_code: string; batch_number: number | null; status: unknown };

export type BatchStatusPush = {
  /** "1705.01" */
  label: string;
  outcome: "same" | "sent" | "ignored" | "failed" | "skipped";
  reason?: string;
  call?: { method: "PATCH"; path: string };
  result?: GssWriteResult;
};

function sameStatus(gss: unknown, code: string): boolean {
  if (gss === null || gss === undefined || gss === "") return false;
  if (typeof gss === "object") return (gss as { code?: unknown }).code === code;
  const s = String(gss).trim().toLowerCase();
  return s === code || s === GSS_BATCH_STATUS_NAME[code];
}

/** Orders donas dos lotes (e as próprias `orderIds`), sem repetição. */
async function resolveOrderIds(db: DB, ref: { orderIds?: string[]; batchIds?: string[] }): Promise<string[]> {
  const ids = new Set((ref.orderIds ?? []).filter(Boolean));
  const batchIds = [...new Set((ref.batchIds ?? []).filter(Boolean))];
  if (batchIds.length) {
    const { data, error } = await db.from("batches").select("order_id").in("id", batchIds);
    if (error) throw new Error(`batches: ${error.message}`);
    for (const b of data ?? []) ids.add(b.order_id);
  }
  return [...ids];
}

/**
 * Manda ao GSS o status de TODOS os lotes das Orders envolvidas (as dadas, ou
 * as donas dos lotes dados). Por Order porque uma troca leva outras junto
 * (regra do Gustavo, Deposit Payment, lote que sai do PL).
 */
export async function pushBatchStatuses(
  db: DB,
  ref: { orderIds?: string[]; batchIds?: string[] },
  opts: { dry?: boolean } = {}
): Promise<BatchStatusPush[]> {
  const orderIds = await resolveOrderIds(db, ref);
  if (!orderIds.length) return [];

  const { data: rows, error } = await db
    .from("batches")
    .select("order_id, gss_id, batch_number, status, orders(po_number, gss_id)")
    .in("order_id", orderIds)
    .not("gss_id", "is", null);
  if (error) throw new Error(`batches: ${error.message}`);

  // Agrupa por Order: uma listagem do GSS por Order.
  type Row = NonNullable<typeof rows>[number];
  const byOrder = new Map<string, Row[]>();
  for (const r of rows ?? []) byOrder.set(r.order_id, [...(byOrder.get(r.order_id) ?? []), r]);

  const out: BatchStatusPush[] = [];
  for (const local of byOrder.values()) {
    const embedded = local[0].orders;
    const order = Array.isArray(embedded) ? embedded[0] : embedded;
    if (!order) continue;
    // Order do GSS: id = nosso po_number; `gss_id` quando gravado.
    const gssOrder = order.gss_id || order.po_number;

    const list = await gssRequest("GET", `/orders/${gssOrder}/batch/`, undefined, { source: "batch-status", ref: `Order ${order.po_number}` });
    if (list.kind !== "ok" || !Array.isArray(list.data)) {
      out.push({ label: String(order.po_number), outcome: "failed", reason: list.error ?? `GET lotes → ${list.status}` });
      continue;
    }
    const remote = new Map((list.data as GssOrderBatch[]).map((b) => [String(b.batch_id), b]));

    for (const b of local) {
      const label = `${order.po_number}${b.batch_number}`;
      const there = remote.get(String(b.gss_id));
      if (!there || there.batch_number === null) {
        out.push({ label, outcome: "skipped", reason: `lote gss_id ${b.gss_id} não está na Order ${gssOrder} do GSS` });
        continue;
      }
      const code = GSS_BATCH_STATUS[b.status as BatchStatus];
      if (!code) {
        out.push({ label, outcome: "skipped", reason: `status ${b.status} sem de-para` });
        continue;
      }
      if (sameStatus(there.status, code)) {
        out.push({ label, outcome: "same" });
        continue;
      }
      const call = { method: "PATCH" as const, path: `/orders/${gssOrder}/batch/${there.batch_number}/` };
      if (opts.dry) {
        out.push({ label, outcome: "skipped", reason: `dry: PATCH ${call.path} {status: "${code}"} (GSS hoje: ${JSON.stringify(there.status)})`, call });
        continue;
      }
      const result = await gssRequest(call.method, call.path, { status: code }, { source: "batch-status", ref: label });
      if (result.kind !== "ok") {
        out.push({ label, outcome: "failed", call, result });
        continue;
      }
      const saved = (result.data as GssOrderBatch | null)?.status;
      out.push({
        label,
        outcome: sameStatus(saved, code) ? "sent" : "ignored",
        reason: sameStatus(saved, code) ? undefined : `GSS respondeu 200 mas manteve status ${JSON.stringify(saved)} (GSS descartou o campo)`,
        call,
        result,
      });
    }
  }
  return out;
}

/** Lotes de um PL — para o envio que roda junto com o do PL/Shipment. */
export async function preLoadingBatchIds(db: DB, preLoadingId: string): Promise<string[]> {
  const { data, error } = await db.from("pre_loading_batches").select("batch_id").eq("pre_loading_id", preLoadingId);
  if (error) throw new Error(`pre_loading_batches: ${error.message}`);
  return (data ?? []).map((l) => l.batch_id);
}

