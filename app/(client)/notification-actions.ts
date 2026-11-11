"use server";

import { revalidatePath } from "next/cache";

import {
  PORTAL_NOTIF_PREF,
  READ_CAP,
  readNotifPrefs,
  type NotifPrefs,
} from "@/domain/client/portal-notifications";
import { requireClientScope } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Grava o estado "lida" do sino no usuário. Relê o profile antes de mesclar
 * para não apagar outra preferência gravada no meio tempo (mesmo cuidado de
 * lib/list-state-actions.ts).
 */
async function updateNotifPrefs(update: (prev: NotifPrefs) => NotifPrefs): Promise<Result> {
  const { session } = await requireClientScope();
  const admin = createAdminClient();
  const { data: fresh, error: readError } = await admin
    .from("profiles")
    .select("ui_preferences")
    .eq("id", session.userId)
    .single();
  if (readError) return { ok: false, error: readError.message };

  const current = (fresh?.ui_preferences ?? {}) as Record<string, unknown>;
  const next = update(readNotifPrefs(current));
  const { error } = await admin
    .from("profiles")
    .update({ ui_preferences: { ...current, [PORTAL_NOTIF_PREF]: next } })
    .eq("id", session.userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/portal", "layout");
  return { ok: true };
}

/** Marca UMA notificação como lida. O id não precisa ser validado contra o
 *  cliente: só entra numa lista de "lidas" do próprio usuário. */
export async function markPortalNotificationRead(id: string): Promise<Result> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "Invalid notification." };
  return updateNotifPrefs((prev) => ({
    ...prev,
    read: [id, ...(prev.read ?? []).filter((x) => x !== id)].slice(0, READ_CAP),
  }));
}

/** "Marcar todas como lidas": tudo até agora vira lido e a lista avulsa zera. */
export async function markAllPortalNotificationsRead(): Promise<Result> {
  return updateNotifPrefs(() => ({ seen_before: new Date().toISOString(), read: [] }));
}
