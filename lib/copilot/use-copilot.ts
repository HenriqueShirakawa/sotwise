"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Cliente do copilot (docs/regras_de_negocio.md §6.1).
 *
 * Consome o stream SSE de `app/api/copilot/route.ts` e separa duas coisas que a
 * rota manda entrelaçadas: o TEXTO que o modelo escreve (prosa curta) e os
 * RESULTADOS estruturados de cada ferramenta (que o painel vira linhas
 * clicáveis do SOT). É essa separação que faz o copilot não ser um chat: o dado
 * volta como dado.
 */

export type CopilotResult = { tool: string; result: unknown };

export type CopilotTurn = {
  role: "user" | "assistant";
  /** Prosa do modelo (turno do usuário guarda a pergunta). */
  text: string;
  /** Blocos de dados que o painel renderiza como linhas (só no assistant). */
  results: CopilotResult[];
  /** Ferramentas que rodaram neste turno — vira o indicador "Consultando…". */
  tools: string[];
  /** true enquanto o stream deste turno não fechou. */
  pending: boolean;
  error: string | null;
};

type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  | { type: "result"; tool: string; result: unknown }
  | { type: "done" }
  | { type: "error"; message: string };

/** A rota aceita até 40 mensagens; mandamos com folga. */
const MAX_HISTORY = 38;
const MAX_CHARS = 4000;

export function useCopilot() {
  const [turns, setTurns] = useState<CopilotTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  /** Aplica um evento do stream ao último turno (o assistant em andamento). */
  const applyEvent = useCallback((evt: StreamEvent) => {
    setTurns((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const i = next.length - 1;
      const cur = next[i];
      switch (evt.type) {
        case "text":
          next[i] = { ...cur, text: cur.text + evt.text };
          break;
        case "tool":
          next[i] = {
            ...cur,
            tools: cur.tools.includes(evt.name) ? cur.tools : [...cur.tools, evt.name],
          };
          break;
        case "result":
          next[i] = { ...cur, results: [...cur.results, { tool: evt.tool, result: evt.result }] };
          break;
        case "done":
          next[i] = { ...cur, pending: false };
          break;
        case "error":
          next[i] = { ...cur, pending: false, error: evt.message };
          break;
      }
      return next;
    });
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;

      // Histórico enviado ao modelo = só os turnos com texto. Os blocos de dados
      // não voltam — a rota roda as ferramentas de novo quando precisa.
      const history = turns
        .filter((t) => t.text.trim().length > 0)
        .slice(-MAX_HISTORY)
        .map((t) => ({ role: t.role, content: t.text.slice(0, MAX_CHARS) }));
      const payload = [...history, { role: "user" as const, content: text.slice(0, MAX_CHARS) }];

      setTurns((prev) => [
        ...prev,
        { role: "user", text, results: [], tools: [], pending: false, error: null },
        { role: "assistant", text: "", results: [], tools: [], pending: true, error: null },
      ]);
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/copilot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: payload }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          applyEvent({ type: "error", message: body?.error ?? "Failed to reach the copilot." });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // Frames SSE são separados por linha em branco; o último pedaço pode
          // estar cortado no meio, então volta pro buffer.
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            try {
              applyEvent(JSON.parse(line.slice(6)) as StreamEvent);
            } catch {
              // frame malformado — ignora e segue o stream.
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          applyEvent({ type: "error", message: "Connection interrupted." });
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, turns, applyEvent]
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setTurns([]);
    setBusy(false);
  }, []);

  return { turns, busy, send, reset };
}
