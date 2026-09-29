/**
 * Estado de uma lista (busca, filtros, ordenação, página…) lembrado entre
 * visitas — o "Keep filters" das telas. Mora no mesmo `profiles.ui_preferences`
 * (JSONB) das preferências de coluna, sob uma chave só (`LIST_STATE_KEY`), com
 * uma entrada por lista. Fica no USUÁRIO, não no navegador: segue a pessoa de
 * máquina em máquina, e o RSC já semeia a tela filtrada (sem flash).
 *
 * `keep` é a escolha da pessoa naquela lista; com ele desligado a entrada fica
 * sem `state` e a lista abre limpa. `at` (epoch ms, relógio do navegador que
 * gravou) desempata a cópia do servidor contra a da memória do cliente — ver
 * `components/keep-filters.tsx`.
 */
export const LIST_STATE_KEY = "list_state";

export type SavedListState = {
  keep: boolean;
  state?: Record<string, unknown>;
  at: number;
};

/** Lê, com segurança, o estado salvo de UMA lista (null = nunca gravou). */
export function readListState(
  uiPreferences: Record<string, unknown> | null | undefined,
  listKey: string
): SavedListState | null {
  const all = uiPreferences?.[LIST_STATE_KEY];
  if (!all || typeof all !== "object") return null;
  const entry = (all as Record<string, unknown>)[listKey];
  if (!entry || typeof entry !== "object") return null;
  const { keep, state, at } = entry as Partial<SavedListState>;
  if (typeof keep !== "boolean") return null;
  return {
    keep,
    state: state && typeof state === "object" ? state : undefined,
    at: typeof at === "number" ? at : 0,
  };
}

/**
 * Nº de filtros ativos pro badge do botão "Filters". Um range de datas (par
 * `x_from`/`x_to`) conta como UM filtro, preenchido de um lado ou dos dois —
 * antes cada ponta contava separado e o número não batia com o que a pessoa
 * via no modal.
 */
export function countActiveFilters(filters: Record<string, string>): number {
  const active = new Set<string>();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== "") active.add(key.replace(/_(from|to)$/, ""));
  }
  return active.size;
}
