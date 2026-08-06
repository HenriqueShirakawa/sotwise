"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, CircleCheck, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import {
  loadMessagesBox,
  loadOrderOptions,
  sendMessage,
  setMessageRead,
  type BoxFilters,
  type BoxPayload,
  type BoxTab,
} from "@/lib/messages-actions";
import type { MessageEntity } from "@/types/database";
import { MultiSearchSelect } from "@/components/multi-search-select";
import { SearchSelect } from "@/components/search-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { MessageCard, MAX_BODY } from "./message-card";

const EMPTY_FILTERS: BoxFilters = {
  tab: "inbox",
  status: "all",
  personId: null,
  recordKey: null,
  clientId: null,
  from: null,
  to: null,
};

const ANY = "__any__";

/**
 * Caixa geral de mensagens — o que o balão abre FORA de um registro. Espelha a
 * tela do Bubble: abas Inbox / My messages, filtros de status, pessoa, pedido,
 * cliente e período, e o botão que leva ao compositor.
 */
export function MessagesBox({
  open,
  onOpenChange,
  onUnreadChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUnreadChange: (unread: number) => void;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState<BoxFilters>(EMPTY_FILTERS);
  const [payload, setPayload] = useState<BoxPayload | null>(null);
  const [composing, setComposing] = useState(false);
  const [pending, startTransition] = useTransition();
  /** A carga roda como transição: o `isPending` já serve de estado de loading,
   * sem setState síncrono dentro do efeito. */
  const [loading, startLoading] = useTransition();

  const refresh = useCallback(
    (next: BoxFilters) => {
      startLoading(async () => {
        const data = await loadMessagesBox(next);
        setPayload(data);
        onUnreadChange(data.unread);
      });
    },
    [onUnreadChange]
  );

  useEffect(() => {
    if (!open) return;
    refresh(filters);
  }, [open, filters, refresh]);

  const patch = (partial: Partial<BoxFilters>) =>
    setFilters((f) => ({ ...f, ...partial }));

  function toggleRead(messageId: string, read: boolean) {
    startTransition(async () => {
      const res = await setMessageRead(messageId, read);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onUnreadChange(res.unread);
      refresh(filters);
    });
  }

  function openRecord(entity: { type: MessageEntity; id: string }) {
    const base =
      entity.type === "order"
        ? "/orders"
        : entity.type === "pre_loading"
          ? "/pre-loading"
          : "/shipments";
    onOpenChange(false);
    router.push(`${base}/${entity.id}`);
  }

  const messages = payload?.messages ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-primary">
            {composing ? "Send message" : "Messages"}
          </DialogTitle>
        </DialogHeader>

        {composing ? (
          <ComposeMessage
            people={payload?.people ?? []}
            pending={pending}
            onCancel={() => setComposing(false)}
            onSent={() => {
              setComposing(false);
              refresh(filters);
            }}
          />
        ) : (
          <div className="space-y-4">
            <div className="inline-flex rounded-lg bg-slate-100 p-1">
              {(["inbox", "mine"] as BoxTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => patch({ tab, personId: null })}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    filters.tab === tab
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500"
                  }`}
                >
                  {tab === "inbox" ? "Inbox" : "My messages"}
                </button>
              ))}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Select
                value={filters.status}
                onValueChange={(v) => patch({ status: v as BoxFilters["status"] })}
              >
                <SelectTrigger className="!h-10 w-full bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Messages</SelectItem>
                  <SelectItem value="unread">Unread</SelectItem>
                  <SelectItem value="read">Read</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filters.personId ?? ANY}
                onValueChange={(v) => patch({ personId: v === ANY ? null : v })}
              >
                <SelectTrigger className="!h-10 w-full bg-white">
                  <SelectValue placeholder="Anyone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>
                    {filters.tab === "inbox" ? "Anyone" : "Anyone marked"}
                  </SelectItem>
                  {(payload?.options.people ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Select
                value={filters.recordKey ?? ANY}
                onValueChange={(v) => patch({ recordKey: v === ANY ? null : v })}
              >
                <SelectTrigger className="!h-10 w-full bg-white">
                  <SelectValue placeholder="Choose an Order" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Choose an Order</SelectItem>
                  {(payload?.options.records ?? []).map((r) => (
                    <SelectItem key={r.key} value={r.key}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filters.clientId ?? ANY}
                onValueChange={(v) => patch({ clientId: v === ANY ? null : v })}
              >
                <SelectTrigger className="!h-10 w-full bg-white">
                  <SelectValue placeholder="Choose a Client" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Choose a Client</SelectItem>
                  {(payload?.options.clients ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 items-center gap-2">
              <Input
                type="date"
                value={filters.from ?? ""}
                onChange={(e) => patch({ from: e.target.value || null })}
                className="h-10 bg-white"
                aria-label="From"
              />
              <Input
                type="date"
                value={filters.to ?? ""}
                onChange={(e) => patch({ to: e.target.value || null })}
                className="h-10 bg-white"
                aria-label="To"
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
                  {filters.tab === "inbox"
                    ? "No messages addressed to you."
                    : "You haven't sent any message yet."}
                </p>
              ) : (
                messages.map((m) => (
                  <MessageCard
                    key={m.id}
                    message={m}
                    number={m.number}
                    client={m.client}
                    showReceipts={filters.tab === "mine"}
                    action={
                      filters.tab === "inbox" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={() => toggleRead(m.id, !m.read)}
                        >
                          {m.read ? (
                            <>
                              <BookOpen className="size-4" />
                              Mark as Unread
                            </>
                          ) : (
                            <>
                              <CircleCheck className="size-4" />
                              Mark as Read
                            </>
                          )}
                        </Button>
                      ) : null
                    }
                    footer={
                      <button
                        type="button"
                        onClick={() => openRecord(m.entity)}
                        className="w-full rounded-lg bg-slate-100 py-2 text-sm text-slate-700 transition hover:bg-slate-200"
                      >
                        Click here to see
                      </button>
                    }
                  />
                ))
              )}
            </div>

            <Button className="w-full" onClick={() => setComposing(true)}>
              Send message
              <ArrowRight className="size-4" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Compositor de fora do registro: aqui o pedido é escolhido, não travado. */
function ComposeMessage({
  people,
  pending,
  onCancel,
  onSent,
}: {
  people: { id: string; name: string }[];
  pending: boolean;
  onCancel: () => void;
  onSent: () => void | Promise<void>;
}) {
  const [orders, setOrders] = useState<{ id: string; name: string }[]>([]);
  const [orderId, setOrderId] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const [sending, startSending] = useTransition();

  useEffect(() => {
    void loadOrderOptions().then(setOrders);
  }, []);

  function handleSend() {
    const text = body.trim();
    if (!orderId || !text) return;
    startSending(async () => {
      const res = await sendMessage({
        entity_type: "order",
        entity_id: orderId,
        body: text,
        recipient_ids: recipients,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setBody("");
      setRecipients([]);
      setOrderId("");
      await onSent();
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Forward to</Label>
        <MultiSearchSelect
          value={recipients}
          onChange={setRecipients}
          options={people}
          placeholder="Forward to"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Order</Label>
        <SearchSelect
          value={orderId}
          onChange={setOrderId}
          options={orders}
          placeholder="Choose an Order"
        />
      </div>

      <div className="rounded-xl border p-3">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
          placeholder="Send a message to the team"
          rows={3}
          className="resize-none border-0 p-0 shadow-none focus-visible:ring-0"
        />
        <div className="mt-2 flex items-center justify-end gap-3">
          <span className="text-xs text-muted-foreground">
            {body.length}/{MAX_BODY}
          </span>
          <Button
            size="sm"
            onClick={handleSend}
            disabled={pending || sending || !orderId || !body.trim()}
          >
            {sending ? <Loader2 className="animate-spin" /> : <Send className="size-4" />}
            Send
          </Button>
        </div>
      </div>

      <Button variant="outline" className="w-full" onClick={onCancel} disabled={sending}>
        Back to messages
      </Button>
    </div>
  );
}
