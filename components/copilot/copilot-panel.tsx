"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCopilot, type CopilotTurn } from "@/lib/copilot/use-copilot";
import { CopilotResults } from "./copilot-results";

/**
 * Painel do copilot do SOT (docs/regras_de_negocio.md §6.1) — coluna dedicada,
 * global. Streaming ao vivo do texto + resultados como linhas clicáveis do SOT.
 * Não é um chat genérico: pouca prosa, muito dado navegável.
 */

/** Rótulo do que cada ferramenta está fazendo, para o indicador "Consultando…". */
const TOOL_LABEL: Record<string, string> = {
  resolve_entities: "identifying",
  search_orders: "searching orders",
  get_order_detail: "opening the order",
  list_etd_entries: "checking ETD",
  list_pre_loadings: "searching pre-loadings",
  search_shipments: "searching shipments",
  list_pending_steps: "checking pending steps",
};

const EXAMPLES = [
  "Which batches are more than 10 days late?",
  "Orders in production",
  "What's pending for me?",
  "Open pre-loadings",
];

export function CopilotPanel({ onClose }: { onClose: () => void }) {
  const { turns, busy, send, reset } = useCopilot();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Cola no fim a cada novidade (texto streamando, linha nova).
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns]);

  function submit() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    void send(text);
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <Sparkles className="size-5 text-primary" />
        <span className="font-semibold text-primary">Copilot</span>
        <div className="ml-auto flex items-center gap-1">
          {turns.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={reset}
              className="text-xs text-muted-foreground"
            >
              Clear
            </Button>
          ) : null}
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close copilot">
            <X className="size-4" />
          </Button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {turns.length === 0 ? (
          <div className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">
              Ask about orders, ETD, pre-loadings, shipments and pending steps. I query the SOT
              and show the rows — click one to open it.
            </p>
            <div className="flex flex-col gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => void send(ex)}
                  className="rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted/60"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((turn, i) => <TurnView key={i} turn={turn} />)
        )}
      </div>

      <div className="shrink-0 border-t p-3">
        <div className="rounded-xl border p-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask the copilot…"
            rows={2}
            className="resize-none border-0 p-0 shadow-none focus-visible:ring-0"
          />
          <div className="mt-1 flex justify-end">
            <Button size="sm" onClick={submit} disabled={busy || !draft.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <Send className="size-4" />}
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TurnView({ turn }: { turn: CopilotTurn }) {
  if (turn.role === "user") {
    return (
      <p className="flex gap-2 border-b pb-3 text-sm font-medium text-foreground">
        <span className="select-none text-primary">❯</span>
        <span>{turn.text}</span>
      </p>
    );
  }

  const idle = turn.pending && !turn.text && turn.results.length === 0;

  return (
    <div className="space-y-2">
      {idle ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {turn.tools.length > 0
            ? `Querying the SOT — ${turn.tools.map((t) => TOOL_LABEL[t] ?? t).join(", ")}…`
            : "Thinking…"}
        </p>
      ) : null}

      {turn.text ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{turn.text}</p>
      ) : null}

      {turn.results.map((r, i) => (
        <CopilotResults key={i} tool={r.tool} result={r.result} />
      ))}

      {turn.pending && !idle ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          writing…
        </p>
      ) : null}

      {turn.error ? (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {turn.error}
        </p>
      ) : null}
    </div>
  );
}
