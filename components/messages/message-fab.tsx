"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { Loader2, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";

import {
  loadThread,
  loadUnreadCount,
  markThreadRead,
  sendMessage,
  type ThreadPayload,
} from "@/lib/messages-actions";
import type { MessageEntity } from "@/types/database";
import { usePoll } from "@/lib/use-poll";
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

import { MessageCard, MAX_BODY } from "./message-card";
import { MessagesBox, MESSAGES_POLL_MS } from "./messages-box";

/** Rota de detalhe (o checklist) → registro que ancora a thread. */
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
 * Balão de mensagens, presente em todo o sistema. Dentro de um checklist
 * (Order / Pre-loading / Shipment) abre a thread daquele registro; fora dali,
 * abre a caixa geral com Inbox / My messages.
 */
export function MessageFab({ initialUnread }: { initialUnread: number }) {
  const pathname = usePathname();
  /** Estável: é dependência do refresh — recriar recarregaria em loop. */
  const entity = useMemo(() => entityFromPath(pathname), [pathname]);

  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);

  // Com o balão fechado, o contador é a única pista de mensagem nova — ele se
  // atualiza sozinho. Aberto, quem sincroniza é o diálogo, que já devolve o
  // número junto com a lista.
  usePoll(
    async () => setUnread(await loadUnreadCount()),
    { enabled: !open, intervalMs: MESSAGES_POLL_MS }
  );

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

      {entity ? (
        <ThreadDialog
          open={open}
          onOpenChange={setOpen}
          entity={entity}
          onUnreadChange={setUnread}
        />
      ) : (
        <MessagesBox open={open} onOpenChange={setOpen} onUnreadChange={setUnread} />
      )}
    </>
  );
}

/** A view de dentro do checklist: contexto travado e histórico do registro. */
function ThreadDialog({
  open,
  onOpenChange,
  entity,
  onUnreadChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: { type: MessageEntity; id: string };
  onUnreadChange: (unread: number) => void;
}) {
  const [payload, setPayload] = useState<ThreadPayload | null>(null);
  /** Igual à caixa geral: a carga roda como transição e o `isPending` é o loading. */
  const [loading, startLoading] = useTransition();
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  /**
   * Carga silenciosa da thread. A leitura vai junto: estar com a thread aberta
   * conta como ler o que chega nela, então o contador não sobe pelas costas.
   */
  const sync = useCallback(async () => {
    const data = await loadThread(entity.type, entity.id);
    setPayload(data);
    const res = await markThreadRead(entity.type, entity.id);
    onUnreadChange(res.ok ? res.unread : data.unread);
  }, [entity, onUnreadChange]);

  useEffect(() => {
    if (!open) return;
    startLoading(async () => {
      await sync();
    });
  }, [open, sync]);

  // Mensagem de outra pessoa entra na thread aberta sem recarregar a página.
  usePoll(sync, { enabled: open, intervalMs: MESSAGES_POLL_MS });

  function handleSend() {
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
      await sync();
    });
  }

  const messages = payload?.messages ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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

          {/* Dentro do registro os dois campos vêm travados: o pedido e eu. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              value={payload?.context?.number ?? "…"}
              readOnly
              disabled
              aria-label="Record"
            />
            <Input value={payload?.me.name ?? "…"} readOnly disabled aria-label="From" />
          </div>

          <div className="max-h-72 space-y-3 overflow-y-auto">
            {loading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 inline size-4 animate-spin" />
                Loading messages…
              </p>
            ) : messages.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No messages for this record yet.
              </p>
            ) : (
              messages.map((m) => (
                <MessageCard
                  key={m.id}
                  message={m}
                  number={payload?.context?.number ?? null}
                  client={payload?.context?.client ?? null}
                  showReceipts
                />
              ))
            )}
          </div>

          <div className="rounded-xl border p-3">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
              placeholder="Send a message to the team"
              rows={2}
              className="resize-none border-0 p-0 shadow-none focus-visible:ring-0"
            />
            <div className="mt-2 flex items-center justify-end gap-3">
              <span className="text-xs text-muted-foreground">
                {body.length}/{MAX_BODY}
              </span>
              <Button size="sm" onClick={handleSend} disabled={pending || !body.trim()}>
                {pending ? <Loader2 className="animate-spin" /> : <Send className="size-4" />}
                Send
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
