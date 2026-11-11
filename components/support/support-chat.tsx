"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquare, Send } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * Thread do chat de suporte (uma por cliente) — usada no portal do cliente e na
 * tela interna Support. Só apresentação + envio: quem renderiza já escopou a
 * thread no servidor e passa as actions.
 *
 * Atualização: `router.refresh()` a cada POLL_MS enquanto a aba está visível
 * (o volume é baixo; Realtime fica para quando precisar).
 */

export type ChatMessage = {
  id: string;
  body: string;
  createdAt: string;
  authorId: string;
  authorName: string;
  fromClient: boolean;
};

type Result = { ok: true } | { ok: false; error: string };

const POLL_MS = 15_000;

function formatWhen(iso: string, locale: string) {
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

export function SupportChat({
  messages,
  viewerId,
  locale,
  maxLength,
  labels,
  tagOf,
  onSend,
  onRead,
  readOnly = false,
  className,
}: {
  messages: ChatMessage[];
  viewerId: string;
  /** Locale do Intl para data/hora (pt-BR, en, es, zh-CN). */
  locale: string;
  maxLength: number;
  labels: {
    empty: string;
    placeholder: string;
    send: string;
    you: string;
    sendError: string;
    tooLong: (max: number) => string;
  };
  /** Rótulo extra ao lado do nome (ex.: "Client" na tela interna). */
  tagOf?: (m: ChatMessage) => string | null;
  onSend: (body: string) => Promise<Result>;
  onRead: () => Promise<unknown>;
  /** Sem permissão de responder: só lê (sem compositor). */
  readOnly?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const lastId = messages.at(-1)?.id ?? null;

  // Rola até a última e marca como lida sempre que chega mensagem nova.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
    void onRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [router]);

  const tooLong = draft.trim().length > maxLength;

  function submit() {
    const body = draft.trim();
    if (!body || tooLong || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await onSend(body);
      if (res.ok) {
        setDraft("");
        router.refresh();
      } else {
        setError(labels.sendError);
      }
    });
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center">
            <MessageSquare className="size-7 text-slate-300" />
            <p className="max-w-xs text-sm text-slate-500">{labels.empty}</p>
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.authorId === viewerId;
            const tag = tagOf?.(m);
            return (
              <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[78%]", mine && "text-right")}>
                  <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-[11px] text-slate-400">
                    <span className={cn("font-medium text-slate-600", mine && "order-2")}>
                      {mine ? labels.you : m.authorName}
                    </span>
                    {tag && !mine ? (
                      <span className="rounded bg-slate-100 px-1.5 py-px text-[10px] font-medium text-slate-500">
                        {tag}
                      </span>
                    ) : null}
                    <span suppressHydrationWarning className={cn(mine && "order-1")}>
                      {formatWhen(m.createdAt, locale)}
                    </span>
                  </div>
                  <div
                    className={cn(
                      "rounded-2xl px-3.5 py-2.5 text-left text-sm whitespace-pre-wrap break-words",
                      mine
                        ? "rounded-tr-sm bg-primary text-primary-foreground"
                        : "rounded-tl-sm border bg-white text-slate-800"
                    )}
                  >
                    {m.body}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {readOnly ? null : (
      <form
        className="border-t bg-slate-50/80 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter envia; Shift+Enter quebra linha.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={labels.placeholder}
            rows={2}
            className="max-h-40 min-h-11 resize-none bg-white"
          />
          <Button type="submit" disabled={!draft.trim() || tooLong || pending} className="h-11">
            {pending ? <Loader2 className="animate-spin" /> : <Send />}
            <span className="hidden sm:inline">{labels.send}</span>
          </Button>
        </div>
        {tooLong || error ? (
          <p className="mt-1.5 text-xs text-red-600">{tooLong ? labels.tooLong(maxLength) : error}</p>
        ) : null}
      </form>
      )}
    </div>
  );
}
