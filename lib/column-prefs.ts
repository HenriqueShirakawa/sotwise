import type { VisibilityState } from "@tanstack/react-table";

/**
 * Preferências de coluna de um usuário, guardadas em `profiles.ui_preferences`
 * (JSONB). Uma entrada por lista: listKey → visibilidade das colunas daquela
 * tabela. Ler/gravar por lista mantém as escolhas das outras intactas.
 */
export type ColumnPrefs = Record<string, VisibilityState>;

/**
 * Extrai, com segurança, a visibilidade salva de UMA lista de dentro do
 * `ui_preferences` do profile (que pode vir null/undefined enquanto o usuário
 * nunca mexeu nas colunas, ou antes da migration existir). Sem entrada = todas
 * visíveis (`{}`), que é o padrão do TanStack Table.
 */
export function readColumnVisibility(
  uiPreferences: Record<string, unknown> | null | undefined,
  listKey: string
): VisibilityState {
  const prefs = uiPreferences?.[listKey];
  if (prefs && typeof prefs === "object") return prefs as VisibilityState;
  return {};
}
