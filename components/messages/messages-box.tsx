"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, CircleCheck, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import {
  loadMessagesBox,
  loadRecordOptions,
  sendMessage,
  setMessageRead,
  type BoxFilters,
  type BoxMessage,
  type BoxPayload,
  type BoxTab,
  type RecordGroup,
} from "@/lib/messages-actions";
import type { MessageEntity } from "@/types/database";
import { MESSAGES_POLL_LIVE_MS, MESSAGES_POLL_MS } from "@/lib/messages-channel";
import { useMessagesRealtime } from "@/lib/use-messages-realtime";
import { usePoll } from "@/lib/use-poll";
import { MultiSearchSelect } from "@/components/multi-search-select";
import { SearchSelect } from "@/components/search-select";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/date-picker";
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
  tab: "received",
  status: "all",
  personId: null,
  recordGroup: null,
  recordNumber: null,
  clientId: null,
  from: null,
  to: null,
};

const ANY = "__any__";

/** Só dois grupos que o usuário reconhece: PO (order) e PL (pre-loading + shipment). */
const GROUP_LABEL: Record<RecordGroup, string> = { po: "PO", pl: "PL" };

/**
 * Caixa geral de mensagens — o que o balão abre FORA de um registro. Duas abas:
 * Received (recebidas, mostra o remetente) e Sent (enviadas, mostra os
 * destinatários), com filtros de status, pessoa, pedido, cliente e período, e o
 * botão que leva ao compositor. De dentro de um registro, o atalho "See all
 * team messages" também traz pra cá.
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

  /** Recarga silenciosa: fora da transição de loading, a lista não pisca. */
  const reload = useCallback(async () => {
    const data = await loadMessagesBox(filters);
    setPayload(data);
    onUnreadChange(data.unread);
  }, [filters, onUnreadChange]);

  // Mensagem nova entra na caixa aberta no instante do envio. Qualquer registro
  // serve: a caixa mistura pedidos, e o filtro é aplicado na recarga.
  const live = useMessagesRealtime(() => {
    if (!open || composing) return;
    void reload();
  });

  // `filters` é lido do render atual, então o polling respeita o filtro.
  usePoll(reload, {
    enabled: open && !composing,
    intervalMs: live ? MESSAGES_POLL_LIVE_MS : MESSAGES_POLL_MS,
  });

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

  /**
   * "Click here to see" leva ao registro E dá a mensagem por lida — abrir o
   * assunto é a leitura. Só vale em Received: em Sent eu sou o autor e a
   * leitura mostrada é a dos destinatários, que não é minha para marcar.
   */
  function openRecord(message: BoxMessage) {
    const { type, id } = message.entity;
    const base =
      type === "order" ? "/orders" : type === "pre_loading" ? "/pre-loading" : "/shipments";

    if (filters.tab === "received" && !message.read) {
      void setMessageRead(message.id, true).then((res) => {
        if (res.ok) onUnreadChange(res.unread);
      });
    }

    onOpenChange(false);
    router.push(`${base}/${id}`);
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
              {(["received", "sent"] as BoxTab[]).map((tab) => (
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
                  {tab === "received" ? "Received" : "Sent"}
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
                    {filters.tab === "received" ? "Anyone" : "Anyone marked"}
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
              {/* Tipo primeiro: some a ambiguidade entre PO e PL de mesmo número. */}
              <Select
                value={filters.recordGroup ?? ANY}
                onValueChange={(v) =>
                  patch({
                    recordGroup: v === ANY ? null : (v as RecordGroup),
                    recordNumber: null,
                  })
                }
              >
                <SelectTrigger className="!h-10 w-full bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any type</SelectItem>
                  <SelectItem value="po">PO</SelectItem>
                  <SelectItem value="pl">PL</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={
                  filters.recordNumber
                    ? `${filters.recordGroup}|${filters.recordNumber}`
                    : ANY
                }
                onValueChange={(v) => {
                  if (v === ANY) {
                    patch({ recordNumber: null });
                    return;
                  }
                  const sep = v.indexOf("|");
                  patch({
                    recordGroup: v.slice(0, sep) as RecordGroup,
                    recordNumber: v.slice(sep + 1),
                  });
                }}
              >
                <SelectTrigger className="!h-10 w-full bg-white">
                  <SelectValue placeholder="Choose a number" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any number</SelectItem>
                  {(payload?.options.records ?? [])
                    .filter((r) => !filters.recordGroup || r.group === filters.recordGroup)
                    .map((r) => {
                      // Sem grupo escolhido, carimba PO/PL pra não confundir números iguais.
                      const label = filters.recordGroup
                        ? r.number
                        : `${GROUP_LABEL[r.group]} ${r.number}`;
                      return (
                        <SelectItem key={`${r.group}|${r.number}`} value={`${r.group}|${r.number}`}>
                          {label}
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
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
              <div />
            </div>

            <div className="grid grid-cols-2 items-center gap-2">
              <DatePicker
                value={filters.from}
                onChange={(v) => patch({ from: v })}
                className="h-10 bg-white"
                ariaLabel="From"
              />
              <DatePicker
                value={filters.to}
                onChange={(v) => patch({ to: v })}
                className="h-10 bg-white"
                ariaLabel="To"
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
                  {filters.tab === "received"
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
                    entityType={m.entity.type}
                    showReceipts={filters.tab === "sent"}
                    action={
                      filters.tab === "received" ? (
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
                        onClick={() => openRecord(m)}
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
  const [recordGroup, setRecordGroup] = useState<RecordGroup>("po");
  // PL agrupa pre_loading + shipment; ao compor, mira o pre_loading (o "PL").
  const entityType: MessageEntity = recordGroup === "po" ? "order" : "pre_loading";
  const [records, setRecords] = useState<{ id: string; name: string }[]>([]);
  const [recordId, setRecordId] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const [sending, startSending] = useTransition();

  // Carrega os números do grupo escolhido. Trocar o grupo limpa a seleção no
  // handler (não aqui), pra não cair na regra de setState-dentro-de-efeito.
  useEffect(() => {
    let alive = true;
    void loadRecordOptions(entityType).then((opts) => {
      if (alive) setRecords(opts);
    });
    return () => {
      alive = false;
    };
  }, [entityType]);

  function handleSend() {
    const text = body.trim();
    if (!recordId || !text) return;
    startSending(async () => {
      const res = await sendMessage({
        entity_type: entityType,
        entity_id: recordId,
        body: text,
        recipient_ids: recipients,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setBody("");
      setRecipients([]);
      setRecordId("");
      setRecordGroup("po");
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

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Record type</Label>
          <Select
            value={recordGroup}
            onValueChange={(v) => {
              setRecordGroup(v as RecordGroup);
              setRecordId("");
              setRecords([]);
            }}
          >
            <SelectTrigger className="!h-10 w-full bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="po">PO</SelectItem>
              <SelectItem value="pl">PL</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{recordGroup === "po" ? "PO number" : "PL number"}</Label>
          <SearchSelect
            value={recordId}
            onChange={setRecordId}
            options={records}
            placeholder={recordGroup === "po" ? "Choose a PO" : "Choose a PL"}
          />
        </div>
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
            disabled={pending || sending || !recordId || !body.trim()}
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
