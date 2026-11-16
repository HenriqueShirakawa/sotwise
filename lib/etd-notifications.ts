import "server-only";

import { fetchAll } from "@/lib/fetch-all";
import type { createAdminClient } from "@/lib/supabase/admin";
import { userTodayIso } from "@/lib/user-time-zone";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Notificação "ETD vencendo" (09/11/2026, card "Notificação ETD vencendo",
 * pedido no card "Ajustes levantados na call de 05-11-26").
 *
 * Regra:
 *  - Pendência = linha ativa da ETD Factories (lote em produção/pre-loading,
 *    view `etd_list`) com **Initial Date ≤ hoje** e **Ready parts = não**, de
 *    Order com a etapa ETD ligada.
 *  - NÃO depende da etapa ETD estar aberta (16/11/2026, pedido do usuário: "Initial
 *    Date atrasada = notificação"). A etapa ETD se conclui sozinha quando todas
 *    as linhas recebem Initial Date — antes da data vencer —, então exigir a
 *    etapa aberta fazia o sino nunca tocar em Order nova.
 *  - Quem recebe (16/11/2026): **user comum** — só as Orders em que é o
 *    Responsible da etapa ETD; **admin e owner** — TODAS as atrasadas (com o
 *    Responsible de cada uma, ou nenhum).
 *  - Quando: no dia em que a Initial Date chega e em TODO dia depois dela — cada
 *    dia é uma notificação nova (não lida), enquanto a pendência existir. Além
 *    do sino, um popup abre sozinho uma vez por dia (ETD_POPUP_KEY).
 *  - Uma notificação por Order por dia (agrupa as fábricas).
 *
 * Sem tabela própria: a lista é calculada na hora a partir do dado (sempre bate
 * com a tela) e o "lido" fica em `profiles.ui_preferences.etd_notifications_read`
 * — chaves `orderId:dia`, só as do dia (as velhas são descartadas ao gravar).
 */

export const ETD_READ_KEY = "etd_notifications_read";
/** Último dia (YYYY-MM-DD) em que o popup diário foi mostrado ao usuário. */
export const ETD_POPUP_KEY = "etd_popup_day";

export type EtdNotification = {
  /** `orderId:YYYY-MM-DD` — muda todo dia, então cada dia notifica de novo. */
  key: string;
  orderId: string;
  poNumber: string;
  client: string | null;
  /** Responsible da etapa ETD (null = ninguém). Só preenchido na visão de admin. */
  responsible: string | null;
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

/** O que o sino recebe do servidor (lib/etd-notifications-actions). */
export type EtdNotificationsPayload = {
  items: EtdNotification[];
  /** Admin/owner: vê todas as atrasadas, não só as em que é Responsible. */
  allOrders: boolean;
  /** O popup diário ainda não foi mostrado hoje. */
  popupDue: boolean;
};

/** Linha atrasada da view `etd_list`, no mínimo que a notificação usa. */
export type OverdueLine = {
  order_id: string;
  po_number: string;
  client: string | null;
  factory: string;
  initial_date: string;
};

/** Etapa ETD (ligada) de uma Order com linha atrasada. */
export type EtdStepRow = { order_id: string; responsible_id: string | null };

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

/** O popup diário ainda não foi mostrado hoje? */
export function popupDueToday(uiPreferences: unknown, today: string): boolean {
  const seen =
    uiPreferences && typeof uiPreferences === "object"
      ? (uiPreferences as Record<string, unknown>)[ETD_POPUP_KEY]
      : undefined;
  return seen !== today;
}

/**
 * Orders que o usuário enxerga: admin/owner (`all`) — toda Order com a etapa
 * ETD ligada; user comum — só as em que ele é o Responsible da etapa ETD.
 */
export function ordersInScope(steps: EtdStepRow[], userId: string, all: boolean): Set<string> {
  return new Set(steps.filter((s) => all || s.responsible_id === userId).map((s) => s.order_id));
}

/** Agrupa as linhas atrasadas em uma notificação por Order (mais atrasadas primeiro). */
export function buildEtdNotifications({
  lines,
  today,
  readKeys,
  responsibleByOrder,
}: {
  lines: OverdueLine[];
  today: string;
  readKeys: Set<string>;
  /** Nome do Responsible por Order (visão de admin); ausente = não mostra. */
  responsibleByOrder?: Map<string, string | null>;
}): EtdNotification[] {
  const byOrder = new Map<string, OverdueLine[]>();
  for (const line of lines) {
    if (!line.initial_date || line.initial_date > today) continue;
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
      responsible: responsibleByOrder?.get(orderId) ?? null,
      lines: group.length,
      factories: [...new Set(group.map((l) => l.factory))].sort(),
      earliestInitialDate: earliest,
      daysOverdue: daysBetween(earliest, today),
      href: `/etd-factories?${qs.toString()}`,
      read: readKeys.has(key),
    });
  }
  return out.sort(
    (a, b) => b.daysOverdue - a.daysOverdue || a.poNumber.localeCompare(b.poNumber, undefined, { numeric: true })
  );
}

/** As notificações de hoje do usuário (mais atrasadas primeiro). */
export async function loadEtdNotifications(
  admin: Admin,
  userId: string,
  uiPreferences: unknown,
  { all = false }: { all?: boolean } = {}
): Promise<EtdNotification[]> {
  const today = await userTodayIso();

  // Começa pelas linhas atrasadas (poucas: ~130 no banco todo em 16/11/2026) e
  // só depois filtra pelas Orders do usuário — uma pessoa chega a ser
  // Responsible de 400+ etapas ETD, quase todas sem linha atrasada.
  const overdue = await fetchAll<OverdueLine>((from, to) =>
    admin
      .from("etd_list")
      .select("order_id, po_number, client, factory, initial_date")
      .lte("initial_date", today)
      .eq("ready_parts", false)
      .order("id")
      .range(from, to)
      .returns<OverdueLine[]>()
  );
  const candidateIds = [...new Set(overdue.map((l) => l.order_id))];
  if (candidateIds.length === 0) return [];

  const steps: EtdStepRow[] = [];
  for (let i = 0; i < candidateIds.length; i += CHUNK) {
    let query = admin
      .from("order_checklist_steps")
      .select("order_id, responsible_id")
      .eq("step", "etd")
      .eq("enabled", true)
      .in("order_id", candidateIds.slice(i, i + CHUNK));
    if (!all) query = query.eq("responsible_id", userId);
    const { data, error } = await query.returns<EtdStepRow[]>();
    if (error) throw new Error(`order_checklist_steps: ${error.message}`);
    steps.push(...(data ?? []));
  }
  const scope = ordersInScope(steps, userId, all);

  // Visão de admin: mostra de quem é cada Order.
  let responsibleByOrder: Map<string, string | null> | undefined;
  if (all) {
    const ids = [...new Set(steps.map((s) => s.responsible_id).filter((id): id is string => !!id))];
    const { data: people, error } = ids.length
      ? await admin.from("profiles").select("id, full_name").in("id", ids)
      : { data: [], error: null };
    if (error) throw new Error(`profiles: ${error.message}`);
    const names = new Map((people ?? []).map((p) => [p.id as string, p.full_name as string]));
    responsibleByOrder = new Map(
      steps.map((s) => [s.order_id, s.responsible_id ? (names.get(s.responsible_id) ?? null) : null])
    );
  }

  return buildEtdNotifications({
    lines: overdue.filter((l) => scope.has(l.order_id)),
    today,
    readKeys: readEtdReadKeys(uiPreferences),
    responsibleByOrder,
  });
}
