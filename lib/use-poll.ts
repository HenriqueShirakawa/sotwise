"use client";

import { useEffect, useRef } from "react";

/**
 * Repete `run` a cada `intervalMs` enquanto `enabled` — é o que mantém as
 * mensagens vivas sem o usuário recarregar a página. Duas regras que evitam
 * consulta à toa: nada roda com a aba em segundo plano, e voltar o foco dispara
 * uma rodada na hora, sem esperar o próximo ciclo.
 *
 * `run` é lido por ref, então pode fechar sobre estado novo a cada render sem
 * reiniciar o timer.
 */
export function usePoll(
  run: () => void | Promise<void>,
  { enabled, intervalMs }: { enabled: boolean; intervalMs: number }
) {
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });

  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void latest.current();
    };

    const id = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [enabled, intervalMs]);
}
