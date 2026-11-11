"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Override<T> = {
  patch: Partial<T>;
  /** Gravações ainda no ar para esta linha. */
  inflight: number;
  /** `rows` do servidor quando a última gravação terminou — o override vale
   *  enquanto não chega uma versão mais nova (null = ainda gravando). */
  settledOn: T[] | null;
};

/**
 * Edição INSTANTÂNEA (10/11/2026, reclamação de lentidão ao trocar datas e
 * responsáveis do checklist): o valor novo aparece na tela no clique e a
 * gravação roda em segundo plano. A tela mostra `rows` (vindas do servidor) com
 * o que o usuário acabou de mudar por cima; quando o servidor devolve a versão
 * nova (o revalidatePath da action ou o realtime), ela volta a ser a fonte de
 * verdade. Se a gravação falhar, o valor volta ao do servidor e `run` devolve o
 * erro para a tela avisar.
 *
 * Sem efeito com setState: o override é derivado — vale enquanto a gravação está
 * no ar ou enquanto `rows` ainda é a mesma de quando ela terminou.
 */
export function useOptimisticRows<T>(rows: T[], keyOf: (row: T) => string) {
  const [overrides, setOverrides] = useState<Record<string, Override<T>>>({});
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const merged = useMemo(
    () =>
      rows.map((row) => {
        const o = overrides[keyOf(row)];
        if (!o) return row;
        const live = o.inflight > 0 || o.settledOn === rows;
        return live ? { ...row, ...o.patch } : row;
      }),
    // keyOf é estável por tela (função inline simples) — não entra na lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, overrides]
  );

  /**
   * Aplica `patch` na linha `key` na hora e roda `save` em segundo plano.
   * Devolve o resultado de `save` (para a tela mostrar o erro, se houver).
   */
  const run = useCallback(
    async <R extends { ok: boolean }>(
      key: string,
      patch: Partial<T>,
      save: () => Promise<R>
    ): Promise<R> => {
      setOverrides((prev) => {
        const cur = prev[key];
        const live = cur && (cur.inflight > 0 || cur.settledOn === rowsRef.current);
        return {
          ...prev,
          [key]: {
            patch: { ...(live ? cur.patch : {}), ...patch },
            inflight: (live ? cur.inflight : 0) + 1,
            settledOn: null,
          },
        };
      });
      let res: R;
      try {
        res = await save();
      } catch (err) {
        res = {
          ok: false,
          error: err instanceof Error ? err.message : "Could not save.",
        } as unknown as R;
      }
      setOverrides((prev) => {
        const cur = prev[key];
        if (!cur) return prev;
        if (!res.ok) {
          // Recusado: volta ao que o servidor tem.
          const next = { ...prev };
          delete next[key];
          return next;
        }
        return {
          ...prev,
          [key]: { ...cur, inflight: cur.inflight - 1, settledOn: rowsRef.current },
        };
      });
      return res;
    },
    []
  );

  return [merged, run] as const;
}

/**
 * O mesmo, para um objeto só (datas da Order, "Placed on" por fábrica, a data
 * de um campo): `run(patch, save)` mostra o patch na hora e grava por trás.
 */
export function useOptimisticObject<T extends object>(server: T) {
  const rows = useMemo(() => [server], [server]);
  const [merged, run] = useOptimisticRows(rows, () => "_");
  const runPatch = useCallback(
    <R extends { ok: boolean }>(patch: Partial<T>, save: () => Promise<R>) =>
      run("_", patch, save),
    [run]
  );
  return [merged[0], runPatch] as const;
}
