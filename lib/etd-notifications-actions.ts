"use server";

import { requireInternal } from "@/lib/dal";
import { todayIso } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ETD_READ_KEY,
  loadEtdNotifications,
  readEtdReadKeys,
  type EtdNotification,
} from "@/lib/etd-notifications";

/** Notificações de ETD vencendo do usuário logado (ver lib/etd-notifications). */
export async function getEtdNotifications(): Promise<EtdNotification[]> {
  const session = await requireInternal();
  const admin = createAdminClient();
  // Relê as preferências: o "lido" pode ter mudado em outra aba.
  const { data } = await admin
    .from("profiles")
    .select("ui_preferences")
    .eq("id", session.userId)
    .single();
  return loadEtdNotifications(admin, session.userId, data?.ui_preferences ?? null);
}

/**
 * Marca como lidas (`keys`) — só as de hoje ficam guardadas; amanhã a mesma
 * Order ainda vencida volta como não lida.
 */
export async function markEtdNotificationsRead(
  keys: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireInternal();
  const today = todayIso();
  const fresh = keys.filter((k) => typeof k === "string" && k.endsWith(`:${today}`)).slice(0, 2000);

  const admin = createAdminClient();
  const { data, error: readError } = await admin
    .from("profiles")
    .select("ui_preferences")
    .eq("id", session.userId)
    .single();
  if (readError) return { ok: false, error: readError.message };

  const current = (data?.ui_preferences ?? {}) as Record<string, unknown>;
  const kept = [...readEtdReadKeys(current)].filter((k) => k.endsWith(`:${today}`));
  const next = { ...current, [ETD_READ_KEY]: [...new Set([...kept, ...fresh])] };

  const { error } = await admin
    .from("profiles")
    .update({ ui_preferences: next })
    .eq("id", session.userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
