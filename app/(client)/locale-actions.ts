"use server";

import { revalidatePath } from "next/cache";

import { PORTAL_LOCALE_PREF } from "@/domain/client/locale";
import { requireClientScope } from "@/lib/dal";
import { isPortalLocale } from "@/lib/portal-i18n";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Grava o idioma escolhido no seletor do portal no próprio usuário
 * (`profiles.ui_preferences.portal_locale`) — vale em qualquer aparelho. Relê o
 * profile antes de mesclar para não apagar outra preferência gravada no meio
 * tempo (mesmo cuidado de lib/list-state-actions.ts).
 */
export async function setPortalLocale(
  locale: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { session } = await requireClientScope();
  if (!isPortalLocale(locale)) return { ok: false, error: "Invalid language." };

  const admin = createAdminClient();
  const { data: fresh, error: readError } = await admin
    .from("profiles")
    .select("ui_preferences")
    .eq("id", session.userId)
    .single();
  if (readError) return { ok: false, error: readError.message };

  const current = (fresh?.ui_preferences ?? {}) as Record<string, unknown>;
  const { error } = await admin
    .from("profiles")
    .update({ ui_preferences: { ...current, [PORTAL_LOCALE_PREF]: locale } })
    .eq("id", session.userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/portal", "layout");
  return { ok: true };
}
