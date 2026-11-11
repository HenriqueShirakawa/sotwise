"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { OnChangeFn, PaginationState, SortingState } from "@tanstack/react-table";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { saveListState } from "@/lib/list-state-actions";
import type { ListStateSeed, SavedListState } from "@/lib/list-state";

// Última versão de cada lista NESTA aba. Sobrevive à navegação client-side (o
// módulo não é recarregado), que é justamente o caso "abri o checklist e voltei":
// o Voltar do navegador pode reaproveitar o RSC em cache, com o `initial` de
// antes do último filtro. Chave = dono + lista.
const memory = new Map<string, SavedListState>();

// Só a busca espera uma pausa antes de gravar (digitar não vira uma escrita por
// tecla). Ordenar, filtrar, trocar de página/aba e a chave gravam na hora — o
// teste natural "ordena e dá F5" não pode perder a ordenação no meio do caminho.
const SEARCH_SAVE_DELAY_MS = 800;

// Tamanho de página das listas — era o `initialState` de cada tabela.
const PAGE_SIZE = 10;

function newest(...entries: (SavedListState | null | undefined)[]): SavedListState | null {
  return entries.reduce<SavedListState | null>(
    (best, e) => (e && (!best || e.at > best.at) ? e : best),
    null
  );
}

// Cópia da aba no sessionStorage: ao contrário do Map acima, sobrevive ao F5.
// Cobre o F5 dado antes de a gravação chegar ao servidor — o HTML volta com o
// estado anterior e esta cópia (mais nova pelo `at`) desempata. Por usuário.
const storageKey = (owner: string, listKey: string) => `sotwise:list-state:${owner}:${listKey}`;

function readStoredRaw(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseStored(raw: string): SavedListState | null {
  try {
    const v = JSON.parse(raw) as Partial<SavedListState> | null;
    return v && typeof v.keep === "boolean" && typeof v.at === "number"
      ? (v as SavedListState)
      : null;
  } catch {
    return null;
  }
}

// O sessionStorage não avisa mudanças feitas na própria aba — nada a assinar.
const noSubscription = () => () => {};

function writeStored(key: string, entry: SavedListState) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Storage bloqueado/cheio: segue valendo o que foi para o servidor.
  }
}

/** Mesmo estado, tirando a busca — decide se a gravação espera a digitação. */
function sameExceptSearch(a: Record<string, unknown>, b: Record<string, unknown>) {
  return JSON.stringify({ ...a, search: null }) === JSON.stringify({ ...b, search: null });
}

/** Mescla o salvo sobre o vazio, um nível abaixo também (o objeto `filters`):
 *  campo de filtro criado depois da gravação entra com o valor vazio. */
function hydrate<T extends Record<string, unknown>>(empty: T, saved: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...empty };
  for (const key of Object.keys(empty)) {
    if (!(key in saved)) continue;
    const base = empty[key];
    const value = saved[key];
    if (base && typeof base === "object" && !Array.isArray(base)) {
      out[key] = value && typeof value === "object" ? { ...base, ...value } : base;
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

/**
 * Estado de uma lista (busca, filtros, ordenação, página…) com "Keep filters":
 * ligado, cada mudança é gravada no usuário e a lista reabre como a pessoa
 * deixou; desligado, a lista abre sempre limpa. Padrão = ligado.
 *
 * `empty` é o estado de uma lista sem filtro nenhum — também o molde que decide
 * quais chaves do salvo são aceitas.
 */
export function useListState<
  T extends Record<string, unknown> & { sorting: SortingState; pageIndex: number },
>(
  listKey: string,
  seed: ListStateSeed,
  empty: T
) {
  const memKey = `${seed.owner}:${listKey}`;
  const tabKey = storageKey(seed.owner, listKey);
  const [initial] = useState(() => newest(memory.get(memKey), seed.saved));
  const [keep, setKeep] = useState(initial?.keep ?? true);
  const [state, setState] = useState<T>(() =>
    initial?.keep !== false && initial?.state ? hydrate(empty, initial.state) : empty
  );

  // F5 logo depois de mexer: a última mudança pode não ter chegado ao servidor
  // e o HTML volta com o estado anterior. A cópia da aba desempata pelo `at`.
  // `useSyncExternalStore` devolve null no servidor e na hidratação (sem
  // divergir do HTML) e a cópia logo em seguida; o ajuste é durante o render,
  // como nos modais. Só conta cópia gravada ANTES desta montagem — as que esta
  // montagem grava depois são dela mesma. O efeito de gravação abaixo reenvia a
  // cópia aplicada ao servidor.
  const [mountedAt] = useState(() => Date.now());
  const storedRaw = useSyncExternalStore(
    noSubscription,
    () => readStoredRaw(tabKey),
    () => null
  );
  const [storageChecked, setStorageChecked] = useState(false);
  if (!storageChecked && storedRaw !== null) {
    setStorageChecked(true);
    const stored = parseStored(storedRaw);
    if (stored && stored.at > (initial?.at ?? 0) && stored.at <= mountedAt) {
      setKeep(stored.keep);
      setState(stored.keep && stored.state ? hydrate(empty, stored.state) : empty);
    }
  }

  const pending = useRef<SavedListState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeen = useRef<{ keep: boolean; state: T } | null>(null);

  function flush() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const entry = pending.current;
    pending.current = null;
    if (!entry) return;
    void saveListState(listKey, entry).then((res) => {
      if (!res.ok) toast.error("Couldn't save your filters.");
    });
  }

  useEffect(() => {
    const prev = lastSeen.current;
    lastSeen.current = { keep, state };
    // Montagem (e o 2º disparo do Strict Mode, com os mesmos objetos): só reflete
    // o que já estava salvo — nada a gravar.
    if (!prev || (prev.keep === keep && prev.state === state)) return;
    const entry: SavedListState = { keep, state: keep ? state : undefined, at: Date.now() };
    memory.set(memKey, entry);
    writeStored(tabKey, entry);
    pending.current = entry;
    if (timer.current) clearTimeout(timer.current);
    const typingOnly = prev.keep === keep && sameExceptSearch(prev.state, state);
    timer.current = setTimeout(flush, typingOnly ? SEARCH_SAVE_DELAY_MS : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memKey, keep, state]);

  // Saindo com gravação na fila (clicou numa linha, F5, fechou a aba): manda na
  // saída. No F5/fechar é melhor-esforço — quem garante é a cópia da aba acima.
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (patch: Partial<T> | ((prev: T) => Partial<T>)) =>
    setState((prev) => ({ ...prev, ...(typeof patch === "function" ? patch(prev) : patch) }));

  // Ligações prontas pro TanStack Table: ordenação e página passam a ser
  // controladas por este estado (senão não dá pra lembrá-las).
  const onSortingChange: OnChangeFn<SortingState> = (updater) =>
    update(
      (prev) =>
        ({ sorting: typeof updater === "function" ? updater(prev.sorting) : updater }) as Partial<T>
    );
  const onPaginationChange: OnChangeFn<PaginationState> = (updater) =>
    update((prev) => {
      const current = { pageIndex: prev.pageIndex, pageSize: PAGE_SIZE };
      const next = typeof updater === "function" ? updater(current) : updater;
      return { pageIndex: next.pageIndex } as Partial<T>;
    });
  // A página salva pode ter sobrado de uma lista que era maior — encosta na última.
  const pagination = (rowCount: number): PaginationState => ({
    pageIndex: Math.min(state.pageIndex, Math.max(Math.ceil(rowCount / PAGE_SIZE) - 1, 0)),
    pageSize: PAGE_SIZE,
  });

  return { state, update, keep, setKeep, onSortingChange, onPaginationChange, pagination };
}

/**
 * Chave "Keep filters" no rodapé do modal de Filters (pedido do usuário: fica
 * dentro do popup, não na barra da lista). Ligada = a lista lembra a filtragem
 * ao voltar; desligada = abre limpa da próxima vez. Vale na hora — é
 * preferência, não rascunho de filtro, então não espera o "Filter". Desligar não
 * apaga o que está na tela agora, só deixa de lembrar.
 */
export function KeepFiltersSwitch({
  keep,
  onChange,
}: {
  keep: boolean;
  onChange: (keep: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2.5 sm:mr-auto">
      <Switch id={id} checked={keep} onCheckedChange={onChange} />
      <label htmlFor={id} className="cursor-pointer leading-tight">
        <span className="block text-sm font-medium text-foreground">Keep filters</span>
        <span className="block text-xs text-muted-foreground">
          Remember them when you come back to this list
        </span>
      </label>
    </div>
  );
}
