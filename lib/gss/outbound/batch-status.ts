/**
 * Status do lote do SOTWISE → `PATCH /v1/orders/{order}/batch/{n}/` do GSS
 * (regras_de_negocio §6.13, pedido do usuário em 19/10/2026).
 *
 * Quando o status muda aqui, o GSS recebe `{status: <id>}` — o `id` do catálogo
 * `GET /orders/batch/status/` (pedido do usuário; antes ia o `code`):
 *
 *   in_negotiation → 1 negotiation   (dropdown do lote)
 *   in_production  → 2 production    (dropdown, Deposit Payment, regra do Gustavo)
 *   preloading     → 3 pre           (Create/Edit PL)
 *   in_transit     → 4 transit       (Confirm Shipping)
 *   delivered      → 5 delivered     (etapa Delivered)
 *   canceled       → 7 canceled
 *
 * ⚠️ 19/10/2026: o Swagger do GSS marca `OrderBatchPatch.status` como
 * readOnly — o PATCH responde 200 e IGNORA o campo (os lotes seguem
 * `status: null` lá). Este envio fica montado; quando o GSS liberar o campo,
 * passa a valer sem mudar nada aqui. Enquanto isso o resultado sai `ignored`.
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

/** id do catálogo do GSS (conferido em 19/10) — é o que vai no PATCH; o GET pode devolver code, id ou nome. */
const GSS_BATCH_STATUS_ID: Record<string, number> = {
  negotiation: 1,
  production: 2,
  pre: 3,
  transit: 4,
  delivered: 5,
  canceled: 7,
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
  if (typeof gss === "object") {
    const o = gss as { code?: unknown; id?: unknown };
    return o.code === code || Number(o.id) === GSS_BATCH_STATUS_ID[code];
  }
  const s = String(gss).trim().toLowerCase();
  return s === code || Number(s) === GSS_BATCH_STATUS_ID[code];
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

    const list = await gssRequest("GET", `/orders/${gssOrder}/batch/`);
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
        out.push({ label, outcome: "skipped", reason: `dry: PATCH ${call.path} {status: ${GSS_BATCH_STATUS_ID[code]}} (${code}) (GSS hoje: ${JSON.stringify(there.status)})`, call });
        continue;
      }
      const result = await gssRequest(call.method, call.path, { status: GSS_BATCH_STATUS_ID[code] });
      if (result.kind !== "ok") {
        out.push({ label, outcome: "failed", call, result });
        continue;
      }
      const saved = (result.data as GssOrderBatch | null)?.status;
      out.push({
        label,
        outcome: sameStatus(saved, code) ? "sent" : "ignored",
        reason: sameStatus(saved, code) ? undefined : `GSS respondeu 200 mas manteve status ${JSON.stringify(saved)} (campo readOnly lá)`,
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

