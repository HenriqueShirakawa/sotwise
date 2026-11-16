"use server";

import { requireInternal } from "@/lib/dal";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  ETD_POPUP_KEY,
  ETD_READ_KEY,
  loadEtdNotifications,
  popupDueToday,
  readEtdReadKeys,
  type EtdNotificationsPayload,
} from "@/lib/etd-notifications";
import { userTodayIso } from "@/lib/user-time-zone";

// O tipo do retorno mora em lib/etd-notifications: arquivo "use server" só
// exporta funções async (export de tipo aqui já derrubou as actions em prod).

/** Notificações de ETD vencendo do usuário logado (ver lib/etd-notifications). */
export async function getEtdNotifications(): Promise<EtdNotificationsPayload> {
  const session = await requireInternal();
  const all = session.isAdmin || session.isOwner;
  const admin = createAdminClient();
  // Relê as preferências: o "lido" pode ter mudado em outra aba.
  const { data } = await admin
    .from("profiles")
    .select("ui_preferences")
    .eq("id", session.userId)
    .single();
  const prefs = data?.ui_preferences ?? null;
  const [items, today] = await Promise.all([
    loadEtdNotifications(admin, session.userId, prefs, { all }),
    userTodayIso(),
  ]);
  return { items, allOrders: all, popupDue: popupDueToday(prefs, today) };
}

async function updatePrefs(
  userId: string,
  change: (current: Record<string, unknown>) => Record<string, unknown>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data, error: readError } = await admin
    .from("profiles")
    .select("ui_preferences")
    .eq("id", userId)
    .single();
  if (readError) return { ok: false, error: readError.message };
  const current = (data?.ui_preferences ?? {}) as Record<string, unknown>;
  const { error } = await admin
    .from("profiles")
    .update({ ui_preferences: change(current) })
    .eq("id", userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Marca como lidas (`keys`) — só as de hoje ficam guardadas; amanhã a mesma
 * Order ainda vencida volta como não lida.
 */
export async function markEtdNotificationsRead(
  keys: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireInternal();
  const today = await userTodayIso();
  const fresh = keys.filter((k) => typeof k === "string" && k.endsWith(`:${today}`)).slice(0, 2000);
  return updatePrefs(session.userId, (current) => {
    const kept = [...readEtdReadKeys(current)].filter((k) => k.endsWith(`:${today}`));
    return { ...current, [ETD_READ_KEY]: [...new Set([...kept, ...fresh])] };
  });
}

/** O popup diário foi mostrado: só volta amanhã (no fuso do usuário). */
export async function markEtdPopupSeen(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireInternal();
  const today = await userTodayIso();
  return updatePrefs(session.userId, (current) => ({ ...current, [ETD_POPUP_KEY]: today }));
}
