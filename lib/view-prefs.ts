/**
 * Preferências de VISUALIZAÇÃO do checklist, por usuário.
 *
 * Mora no mesmo `profiles.ui_preferences` (JSONB) das preferências de coluna,
 * num namespace próprio (`views`) — por isso `lib/column-prefs.ts` continua
 * intacto: as duas leem chaves diferentes do mesmo objeto e uma nunca apaga a
 * outra (a gravação sempre mescla).
 *
 * ⚠️ Isto NÃO é autorização. Ninguém é bloqueado por esconder uma etapa: o
 * usuário liga e desliga para si, e o servidor não usa nada daqui para decidir
 * escrita. Quem controla acesso é `domain/access/features.ts` + `lib/dal.ts`.
 */

export const VIEW_PREFS_KEY = "views";

export type ViewPrefs = {
  /** Mostra só as etapas em que o usuário é o responsável. */
  onlyMySteps: boolean;
  /** Esconde etapas já concluídas (ver `lib/checklist-completion`). */
  hideCompletedSteps: boolean;
  /** Esconde as etapas desabilitadas do checklist. */
  hideDisabledSteps: boolean;
};

export const DEFAULT_VIEW_PREFS: ViewPrefs = {
  onlyMySteps: false,
  hideCompletedSteps: false,
  hideDisabledSteps: false,
};

/** Rótulos da tela de perfil — centralizados para servidor e cliente casarem. */
export const VIEW_PREF_LABELS: Record<keyof ViewPrefs, { title: string; hint: string }> = {
  onlyMySteps: {
    title: "Only my steps",
    hint: "Hide checklist steps assigned to someone else.",
  },
  hideCompletedSteps: {
    title: "Hide completed steps",
    hint: "Keep the checklist focused on what is still open.",
  },
  hideDisabledSteps: {
    title: "Hide disabled steps",
    hint: "Skip the steps that are turned off for this record.",
  },
};

export const VIEW_PREF_KEYS = Object.keys(DEFAULT_VIEW_PREFS) as (keyof ViewPrefs)[];

/**
 * Lê as preferências de dentro do `ui_preferences` do profile, que pode vir
 * null (usuário que nunca mexeu) ou com chaves faltando (preferência nova
 * adicionada depois). Chave ausente cai no default — nunca em `undefined`.
 */
export function readViewPrefs(
  uiPreferences: Record<string, unknown> | null | undefined
): ViewPrefs {
  const raw = uiPreferences?.[VIEW_PREFS_KEY];
  if (!raw || typeof raw !== "object") return { ...DEFAULT_VIEW_PREFS };

  const stored = raw as Partial<Record<keyof ViewPrefs, unknown>>;
  const prefs = { ...DEFAULT_VIEW_PREFS };
  for (const key of VIEW_PREF_KEYS) {
    if (typeof stored[key] === "boolean") prefs[key] = stored[key];
  }
  return prefs;
}

/** Etapa do checklist, no mínimo que os filtros precisam ver. */
type FilterableStep = {
  enabled?: boolean;
  completed_on: string | null;
  responsible_id: string | null;
  /**
   * Etapa concluída pela regra de `lib/checklist-completion` — as três telas já
   * derivam esse campo antes de filtrar. Ausente, "concluída" cai em ter
   * `completed_on`, que é a condição comum às 24 etapas.
   */
  done?: boolean;
};

/**
 * Aplica as preferências a uma lista de etapas. Puro, para as três telas de
 * checklist (Order, Pre-loading, Shipment) filtrarem igual.
 *
 * `onlyMySteps` mantém as etapas sem responsável definido: escondê-las deixaria
 * o usuário sem ver justamente o que ainda precisa ser atribuído.
 */
export function filterSteps<T extends FilterableStep>(
  steps: T[],
  prefs: ViewPrefs,
  currentUserId: string
): T[] {
  return steps.filter((step) => {
    if (prefs.onlyMySteps && step.responsible_id && step.responsible_id !== currentUserId) {
      return false;
    }
    if (prefs.hideCompletedSteps && (step.done ?? !!step.completed_on)) return false;
    if (prefs.hideDisabledSteps && step.enabled === false) return false;
    return true;
  });
}
