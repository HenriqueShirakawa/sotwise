"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, Loader2, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";

import { formatDateTime } from "@/lib/format";
import {
  loadInbox,
  loadThread,
  markAllRead,
  markThreadRead,
  sendMessage,
  type ThreadPayload,
} from "@/lib/messages-actions";
import type { MessageEntity } from "@/types/database";
import { MultiSearchSelect } from "@/components/multi-search-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const MAX_BODY = 500;

/** Rota de detalhe → registro que ancora a thread. */
const ROUTE_ENTITY: { prefix: string; entity: MessageEntity }[] = [
  { prefix: "/orders/", entity: "order" },
  { prefix: "/pre-loading/", entity: "pre_loading" },
  { prefix: "/shipments/", entity: "shipment" },
];

function entityFromPath(pathname: string): { type: MessageEntity; id: string } | null {
  for (const { prefix, entity } of ROUTE_ENTITY) {
    if (!pathname.startsWith(prefix)) continue;
    const id = pathname.slice(prefix.length).split("/")[0];
    if (id) return { type: entity, id };
  }
  return null;
}

/**
 * Balão flutuante de mensagens, presente em todo o sistema (canto inferior
 * direito, com o contador de não lidas). Dentro de um Order/Pre-loading/
 * Shipment ele abre a thread DAQUELE registro — que todos que abrem o registro
 * enxergam. Fora dali, abre a caixa geral, que mostra só o que foi endereçado
 * a mim.
 */
export function MessageFab({ initialUnread }: { initialUnread: number }) {
  const pathname = usePathname();
  /** Precisa ser estável: é dependência do refresh e do efeito de abertura —
   * recriar o objeto a cada render recarregaria a thread em loop. */
  const entity = useMemo(() => entityFromPath(pathname), [pathname]);

  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [payload, setPayload] = useState<ThreadPayload | null>(null);
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const data = entity ? await loadThread(entity.type, entity.id) : await loadInbox();
    setPayload(data);
    setUnread(data.unread);
    setLoading(false);
    return data;
  }, [entity]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      await refresh();
      if (!active || !entity) return;
      // Abrir a thread do registro conta como leitura das minhas pendentes.
      const res = await markThreadRead(entity.type, entity.id);
      if (active && res.ok) setUnread(res.unread);
    })();
    return () => {
      active = false;
    };
    // `refresh` já carrega o entity atual — recarrega ao abrir e ao trocar de registro.
  }, [open, refresh, entity]);

  function handleSend() {
    if (!entity) {
      toast.error("Open an order, pre-loading or shipment to send a message.");
      return;
    }
    const text = body.trim();
    if (!text) return;

    startTransition(async () => {
      const res = await sendMessage({
        entity_type: entity.type,
        entity_id: entity.id,
        body: text,
        recipient_ids: recipients,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setBody("");
      setRecipients([]);
      await refresh();
    });
  }

  function handleMarkAllRead() {
    startTransition(async () => {
      const res = await markAllRead();
      if (res.ok) {
        setUnread(res.unread);
        await refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  const messages = payload?.messages ?? [];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Messages"
        className="fixed right-6 bottom-6 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:brightness-110"
      >
        <MessageCircle className="size-6" />
        {unread > 0 ? (
          <span className="absolute -top-1 -right-1 flex min-w-6 items-center justify-center rounded-full bg-emerald-500 px-1.5 py-0.5 text-xs font-semibold text-white">
            {unread > 9 ? "+9" : unread}
          </span>
        ) : null}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-primary">Send message</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <MultiSearchSelect
              value={recipients}
              onChange={setRecipients}
              options={payload?.people ?? []}
              placeholder="Forward to"
            />

            {/* Dentro de um registro os dois campos vêm travados no contexto atual. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                value={payload?.context?.number ?? (entity ? "…" : "All records")}
                readOnly
                disabled
                aria-label="Record"
              />
              <Input
                value={payload?.context?.client ?? "—"}
                readOnly
                disabled
                aria-label="Client"
              />
            </div>

            <div className="max-h-72 space-y-3 overflow-y-auto">
              {loading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 inline size-4 animate-spin" />
                  Loading messages…
                </p>
              ) : messages.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {entity
                    ? "No messages for this record yet."
                    : "No messages addressed to you."}
                </p>
              ) : (
                messages.map((m) => (
                  <article key={m.id} className="rounded-xl bg-slate-50 p-4 text-sm">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <p className="text-slate-800">
                        <strong>{m.author_name}</strong> : {m.body}
                      </p>
                      <ReadReceipts recipients={m.recipients} />
                    </div>
                    <div className="flex items-end justify-between gap-2 text-slate-600">
                      <div>
                        {payload?.context?.client ? (
                          <p>
                            Client: <strong>{payload.context.client}</strong>
                          </p>
                        ) : null}
                        <p>
                          Record: <strong>{m.context ?? payload?.context?.number ?? "—"}</strong>
                        </p>
                      </div>
                      <time className="text-xs text-muted-foreground">
                        {formatDateTime(m.created_at)}
                      </time>
                    </div>
                  </article>
                ))
              )}
            </div>

            {!entity && unread > 0 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleMarkAllRead}
                disabled={pending}
              >
                Mark all as read
              </Button>
            ) : null}

            <div className="relative rounded-xl border p-3">
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
                placeholder="Send a message to the team"
                rows={2}
                className="resize-none border-0 p-0 shadow-none focus-visible:ring-0"
                disabled={!entity}
              />
              <div className="mt-2 flex items-center justify-end gap-3">
                <span className="text-xs text-muted-foreground">
                  {body.length}/{MAX_BODY}
                </span>
                <Button size="sm" onClick={handleSend} disabled={pending || !body.trim()}>
                  {pending ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  Send
                </Button>
              </div>
              {!entity ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Open an order, pre-loading or shipment to write to its thread.
                </p>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** "Messages read" do print: quem foi marcado e se já leu. */
function ReadReceipts({
  recipients,
}: {
  recipients: { user_id: string; name: string; read_at: string | null }[];
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
