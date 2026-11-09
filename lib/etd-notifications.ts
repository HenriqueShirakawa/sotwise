import "server-only";

import { todayIso } from "@/lib/format";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Notificação "ETD vencendo" (09/11/2026, card "Notificação ETD vencendo",
 * pedido no card "Ajustes levantados na call de 05-11-26").
 *
 * Regra:
 *  - Quem recebe: o **Responsible da etapa ETD** da Order.
 *  - Quando: no dia em que a **Initial Date** de uma linha da ETD Factories
 *    chega e em TODO dia depois dela — cada dia é uma notificação nova (não
 *    lida), enquanto a pendência existir.
 *  - Pendência = linha ativa da ETD Factories (lote em produção/pre-loading,
 *    view `etd_list`) com Initial Date ≤ hoje e Ready parts = não, de Order
 *    cuja etapa ETD está ligada e ainda não concluída.
 *  - Uma notificação por Order por dia (agrupa as fábricas).
 *
 * Sem tabela própria: a lista é calculada na hora a partir do dado (sempre bate
 * com a tela) e o "lido" fica em `profiles.ui_preferences.etd_notifications_read`
 * — chaves `orderId:dia`, só as do dia (as velhas são descartadas ao gravar).
 */

export const ETD_READ_KEY = "etd_notifications_read";

export type EtdNotification = {
  /** `orderId:YYYY-MM-DD` — muda todo dia, então cada dia notifica de novo. */
  key: string;
  orderId: string;
  poNumber: string;
  client: string | null;
  /** Linhas (Factory × Category) com Initial Date vencida e sem Ready parts. */
  lines: number;
  factories: string[];
  /** A Initial Date mais antiga entre as linhas. */
  earliestInitialDate: string;
  /** Dias desde a Initial Date mais antiga (0 = vence hoje). */
  daysOverdue: number;
  /** ETD Factories filtrada nesta Order e nas linhas vencidas. */
  href: string;
  read: boolean;
};

const CHUNK = 150;

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export function readEtdReadKeys(uiPreferences: unknown): Set<string> {
  const raw =
    uiPreferences && typeof uiPreferences === "object"
      ? (uiPreferences as Record<string, unknown>)[ETD_READ_KEY]
      : undefined;
  return new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string") : []);
}

/** As notificações de hoje do usuário (mais atrasadas primeiro). */
export async function loadEtdNotifications(
  admin: Admin,
  userId: string,
  uiPreferences: unknown
): Promise<EtdNotification[]> {
  const today = todayIso();

  const { data: steps, error } = await admin
    .from("order_checklist_steps")
    .select("order_id")
    .eq("step", "etd")
    .eq("responsible_id", userId)
    .eq("enabled", true)
    .is("completed_on", null);
  if (error) throw new Error(`order_checklist_steps: ${error.message}`);
  const orderIds = [...new Set((steps ?? []).map((s) => s.order_id as string))];
  if (orderIds.length === 0) return [];

  type Line = {
    order_id: string;
    po_number: string;
    client: string | null;
    factory: string;
    initial_date: string;
  };
  const lines: Line[] = [];
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const { data, error: lError } = await admin
      .from("etd_list")
      .select("order_id, po_number, client, factory, initial_date")
      .in("order_id", orderIds.slice(i, i + CHUNK))
      .lte("initial_date", today)
      .eq("ready_parts", false)
      .returns<Line[]>();
    if (lError) throw new Error(`etd_list: ${lError.message}`);
    lines.push(...(data ?? []));
  }

  const read = readEtdReadKeys(uiPreferences);
  const byOrder = new Map<string, Line[]>();
  for (const line of lines) {
    if (!line.initial_date) continue;
    const list = byOrder.get(line.order_id) ?? [];
    list.push(line);
    byOrder.set(line.order_id, list);
  }

  const out: EtdNotification[] = [];
  for (const [orderId, group] of byOrder) {
    const earliest = group.map((l) => l.initial_date).sort()[0];
    const key = `${orderId}:${today}`;
    const po = group[0].po_number;
    const qs = new URLSearchParams({ q: po, initial_to: today, ready_parts: "no" });
    out.push({
      key,
      orderId,
      poNumber: po,
      client: group[0].client,
      lines: group.length,
      factories: [...new Set(group.map((l) => l.factory))].sort(),
      earliestInitialDate: earliest,
      daysOverdue: daysBetween(earliest, today),
      href: `/etd-factories?${qs.toString()}`,
      read: read.has(key),
    });
  }
  return out.sort(
    (a, b) => b.daysOverdue - a.daysOverdue || a.poNumber.localeCompare(b.poNumber, undefined, { numeric: true })
  );
}
