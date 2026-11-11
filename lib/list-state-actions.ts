"use server";

import { requireInternal } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { LIST_STATE_KEY, type SavedListState } from "@/lib/list-state";

// Teto de sanidade: o estado de uma lista são uns poucos campos curtos.
const MAX_STATE_BYTES = 8_000;

/**
 * Grava o estado de UMA lista no usuário logado
 * (`profiles.ui_preferences.list_state[listKey]`). Relê o profile na hora em vez
 * de usar o da sessão: esta action dispara com frequência (a cada filtro) e um
 * `ui_preferences` velho apagaria uma escolha de colunas gravada no meio tempo.
 * Sem `revalidatePath`, como nas colunas — o cliente já está com o estado.
 */
export async function saveListState(
  listKey: string,
  entry: SavedListState
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireInternal();

  if (!/^[a-z0-9-]{1,40}$/.test(listKey)) return { ok: false, error: "Invalid list." };
  const clean: SavedListState = {
    keep: entry?.keep === true,
    at: typeof entry?.at === "number" ? entry.at : Date.now(),
  };
  if (clean.keep && entry.state && typeof entry.state === "object") {
    if (JSON.stringify(entry.state).length > MAX_STATE_BYTES) {
      return { ok: false, error: "List state too large." };
    }
    clean.state = entry.state;
  }

  const admin = createAdminClient();
  const { data: fresh, error: readError } = await admin
    .from("profiles")
    .select("ui_preferences")
    .eq("id", session.userId)
    .single();
  if (readError) return { ok: false, error: readError.message };

  const current = (fresh?.ui_preferences ?? {}) as Record<string, unknown>;
  const lists = (current[LIST_STATE_KEY] ?? {}) as Record<string, unknown>;
  const next = { ...current, [LIST_STATE_KEY]: { ...lists, [listKey]: clean } };

  const { error } = await admin
    .from("profiles")
    .update({ ui_preferences: next })
    .eq("id", session.userId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
