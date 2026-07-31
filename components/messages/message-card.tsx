"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { formatDateTime } from "@/lib/format";
import type { ThreadMessage } from "@/lib/messages";

/** Limite do compositor (contador 0/500 no Bubble). */
export const MAX_BODY = 500;

/**
 * Cartão de uma mensagem — mesmo desenho dentro do registro e na caixa geral:
 * "Autor : texto", o carimbo de Client/Number Order e a data. O que muda é o
 * canto superior direito (marcar lida/não lida ou a confirmação de leitura) e
 * o rodapé ("Click here to see").
 */
export function MessageCard({
  message,
  number,
  client,
  showReceipts = false,
  action,
  footer,
}: {
  message: ThreadMessage;
  number: string | null;
  client: string | null;
  /** Confirmação de leitura — faz sentido nas mensagens que EU enviei. */
  showReceipts?: boolean;
  action?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <article className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-slate-800">
          <strong>{message.author_name}</strong> : {message.body}
        </p>
        {showReceipts ? <ReadReceipts recipients={message.recipients} /> : action}
      </div>

      <div className="flex items-end justify-between gap-2 text-slate-600">
        <div>
          {client ? (
            <p>
              Client: <strong>{client}</strong>
            </p>
          ) : null}
          <p>
            Number Order: <strong>{number ?? "—"}</strong>
          </p>
        </div>
        <time className="text-xs text-muted-foreground">
          {formatDateTime(message.created_at)}
        </time>
      </div>

      {footer}
    </article>
  );
}

/** "Messages read" do print: quem foi marcado e se já leu. */
export function ReadReceipts({
  recipients,
}: {
  recipients: ThreadMessage["recipients"];
}) {
  const [open, setOpen] = useState(false);
  if (!recipients.length) return null;

  const readCount = recipients.filter((r) => r.read_at).length;

  return (
    <div className="shrink-0 text-right">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-full border bg-white px-2.5 py-1 text-xs text-slate-600"
      >
        Messages read {readCount}/{recipients.length}
        <ChevronDown className={`size-3.5 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {recipients.map((r) => (
            <li key={r.user_id}>
              {r.name} — {r.read_at ? formatDateTime(r.read_at) : "unread"}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
