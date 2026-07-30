"use server";

import type { VisibilityState } from "@tanstack/react-table";

import { verifySession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ColumnPrefs } from "@/lib/column-prefs";

/**
 * Grava a visibilidade de colunas de UMA lista no usuário logado
 * (`profiles.ui_preferences[listKey]`), mesclando com o que já estava salvo pra
 * não apagar as outras listas. Sem `revalidatePath`: o cliente já atualizou o
 * estado otimista, e o próximo carregamento lê o profile fresco no `verifySession`.
 */
export async function saveColumnVisibility(
  listKey: string,
  visibility: VisibilityState
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await verifySession();

  const current = (session.profile.ui_preferences ?? {}) as ColumnPrefs;
  const next: ColumnPrefs = { ...current, [listKey]: visibility };

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ ui_preferences: next })
    .eq("id", session.userId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
