"use server";

import { revalidatePath } from "next/cache";

import { requireInternal } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_VIEW_PREFS,
  VIEW_PREFS_KEY,
  VIEW_PREF_KEYS,
  type ViewPrefs,
} from "@/lib/view-prefs";

/**
 * Grava as preferências de visualização do PRÓPRIO usuário. `requireInternal` e
 * não `requireFeature`: isto é preferência pessoal, não uma feature — todo
 * usuário interno ajusta a sua (mesma lógica de `profile/actions.ts`); as telas
 * a que essas preferências se referem não existem no portal do cliente.
 *
 * Mescla com o `ui_preferences` existente para não apagar as preferências de
 * coluna, que dividem o mesmo JSONB.
 */
export async function saveViewPrefs(
  input: Partial<ViewPrefs>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireInternal();

  // Só as chaves conhecidas entram — o corpo vem do cliente.
  const clean: ViewPrefs = { ...DEFAULT_VIEW_PREFS };
  for (const key of VIEW_PREF_KEYS) {
    if (typeof input[key] === "boolean") clean[key] = input[key];
  }

  const current = (session.profile.ui_preferences ?? {}) as Record<string, unknown>;
  const next = { ...current, [VIEW_PREFS_KEY]: clean };

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ ui_preferences: next })
    .eq("id", session.userId);

  if (error) return { ok: false, error: error.message };

  // Diferente das preferências de coluna (estado local do TanStack Table), estas
  // mudam o que as telas de checklist renderizam no servidor — precisa revalidar.
  revalidatePath("/", "layout");
  return { ok: true };
}
