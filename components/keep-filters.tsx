"use client";

import { useEffect, useRef, useState } from "react";
import type { OnChangeFn, PaginationState, SortingState } from "@tanstack/react-table";
import { Pin, PinOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { saveListState } from "@/lib/list-state-actions";
import type { SavedListState } from "@/lib/list-state";
import { cn } from "@/lib/utils";

// Última versão de cada lista NESTA aba. Sobrevive à navegação client-side (o
// módulo não é recarregado), que é justamente o caso "abri o checklist e voltei":
// o Voltar do navegador pode reaproveitar o RSC em cache, com o `initial` de
// antes do último filtro. Num F5 isto zera e vale o que veio do servidor.
const memory = new Map<string, SavedListState>();

// Espera entre a última mudança e a gravação — digitar na busca não vira uma
// escrita por tecla.
const SAVE_DELAY_MS = 800;

// Tamanho de página das listas — era o `initialState` de cada tabela.
const PAGE_SIZE = 10;

function newest(a: SavedListState | undefined, b: SavedListState | null) {
  if (!a) return b;
  if (!b) return a;
  return a.at >= b.at ? a : b;
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
  initial: SavedListState | null,
  empty: T
) {
  const [seed] = useState(() => newest(memory.get(listKey), initial));
  const [keep, setKeep] = useState(seed?.keep ?? true);
  const [state, setState] = useState<T>(() =>
    seed?.keep !== false && seed?.state ? hydrate(empty, seed.state) : empty
  );

  const pending = useRef<SavedListState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);

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
    // A montagem só reflete o que já estava salvo — nada a gravar.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const entry: SavedListState = { keep, state: keep ? state : undefined, at: Date.now() };
    memory.set(listKey, entry);
    pending.current = entry;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, keep, state]);

  // Saiu da tela (clicou numa linha) antes do debounce: grava na saída.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => flush(), []);

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
 * Botão "Keep filters" ao lado do Filters: alfinete preenchido = a lista lembra
 * a filtragem ao voltar; riscado = abre limpa da próxima vez. Desligar não
 * apaga o que está na tela agora, só deixa de lembrar.
 */
export function KeepFiltersToggle({
  keep,
  onChange,
  onAfterClick,
}: {
  keep: boolean;
  onChange: (keep: boolean) => void;
  /** Fecha o "⋮" da toolbar no mobile. */
  onAfterClick?: () => void;
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            aria-pressed={keep}
            className={cn(
              "h-11 rounded-xl bg-white",
              keep &&
                "border-primary/40 bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary"
            )}
            onClick={() => {
              onChange(!keep);
              onAfterClick?.();
            }}
          >
            {keep ? <Pin /> : <PinOff />}
            {keep ? "Keeping filters" : "Keep filters"}
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">
          {keep
            ? "Filters, search and page are remembered when you come back to this list. Click to stop remembering."
            : "This list opens without filters. Click to remember your filters when you come back."}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
