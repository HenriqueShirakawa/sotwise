/**
 * Status da Order do SOTWISE → `PATCH /v1/orders/{id}/` do GSS (pedido do
 * usuário em 26/10/2026: "sempre que houver uma mudança a gente manda para o
 * GSS esse status").
 *
 * O GSS recebe `{status: "<code>"}` — o `code` do catálogo `GET /orders/status/`
 * — e devolve o NOME no GET/PATCH (catálogo conferido em 26/10):
 *
 *   in_negotiation      → negotiation          → "In Negotiation"
 *   in_production       → production           → "In Production"
 *   pre_loading         → pre                  → "Pre-Loading"
 *   partially_shipped   → partially_ship       → "Partially Shipped"
 *   shipped             → shipped              → "Shipped"
 *   partially_delivered → partially_delivered  → "Partially Delivered"
 *   delivered           → delivered            → "Delivered"
 *   canceled            → canceled             → "Canceled"
 *
 * O catálogo tem ainda `std_by` (Stand by, sem par aqui) e os legados em
 * maiúscula `PRE_SHIPMENT` / `PARTIALLY_SHIPPED` — não usados.
 *
 * Por Order: lê a Order no GSS e só faz PATCH quando o status difere — não ecoa
 * nem repete. Order do GSS: id = nosso `po_number` (ou `gss_id`, quando gravado),
 * mesmo casamento do status do lote (batch-status.ts).
 *
 * Sem `server-only` e com imports relativos, como os outros envios.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, OrderStatus } from "../../../types/database";
import { gssRequest, type GssWriteResult } from "../client";

type DB = SupabaseClient<Database>;

export const GSS_ORDER_STATUS: Record<OrderStatus, string> = {
  in_negotiation: "negotiation",
  in_production: "production",
  pre_loading: "pre",
  partially_shipped: "partially_ship",
  shipped: "shipped",
  partially_delivered: "partially_delivered",
  delivered: "delivered",
  canceled: "canceled",
};

/** Nome que o GSS devolve para cada code (catálogo conferido em 26/10). */
const GSS_ORDER_STATUS_NAME: Record<string, string> = {
  negotiation: "in negotiation",
  production: "in production",
  pre: "pre-loading",
  partially_ship: "partially shipped",
  shipped: "shipped",
  partially_delivered: "partially delivered",
  delivered: "delivered",
  canceled: "canceled",
};

export type OrderStatusPush = {
  /** po_number */
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
  return s === code || s === GSS_ORDER_STATUS_NAME[code];
}

/** Manda ao GSS o status atual de cada Order dada (só o que difere de lá). */
export async function pushOrderStatuses(
  db: DB,
  orderIds: string[],
  opts: { dry?: boolean } = {}
): Promise<OrderStatusPush[]> {
  const ids = [...new Set(orderIds.filter(Boolean))];
  if (!ids.length) return [];

  const { data: rows, error } = await db.from("orders").select("po_number, gss_id, status").in("id", ids);
  if (error) throw new Error(`orders: ${error.message}`);

  const out: OrderStatusPush[] = [];
  for (const order of rows ?? []) {
    const label = String(order.po_number);
    const gssOrder = order.gss_id || order.po_number;
    const code = GSS_ORDER_STATUS[order.status];
    if (!code) {
      out.push({ label, outcome: "skipped", reason: `status ${order.status} sem de-para` });
      continue;
    }

    const there = await gssRequest("GET", `/orders/${gssOrder}/`, undefined, { source: "order-status", ref: `Order ${label}` });
    if (there.status === 404) {
      out.push({ label, outcome: "skipped", reason: `Order ${gssOrder} não existe no GSS` });
      continue;
    }
    if (there.kind !== "ok") {
      out.push({ label, outcome: "failed", reason: there.error ?? `GET → ${there.status}` });
      continue;
    }
    const current = (there.data as { status?: unknown } | null)?.status;
    if (sameStatus(current, code)) {
      out.push({ label, outcome: "same" });
      continue;
    }

    const call = { method: "PATCH" as const, path: `/orders/${gssOrder}/` };
    if (opts.dry) {
      out.push({ label, outcome: "skipped", reason: `dry: PATCH ${call.path} {status: "${code}"} (GSS hoje: ${JSON.stringify(current)})`, call });
      continue;
    }
    const result = await gssRequest(call.method, call.path, { status: code }, { source: "order-status", ref: `Order ${label}` });
    if (result.kind !== "ok") {
      out.push({ label, outcome: "failed", call, result });
      continue;
    }
    const saved = (result.data as { status?: unknown } | null)?.status;
    out.push({
      label,
      outcome: sameStatus(saved, code) ? "sent" : "ignored",
      reason: sameStatus(saved, code) ? undefined : `GSS respondeu 200 mas manteve status ${JSON.stringify(saved)} (GSS descartou o campo)`,
      call,
      result,
    });
  }
  return out;
}
