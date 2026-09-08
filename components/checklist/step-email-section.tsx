"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronDown, Mail, Send, User } from "lucide-react";
import { toast } from "sonner";

import { formatDateTime } from "@/lib/format";
import {
  loadStepEmailHistory,
  loadStepRecipientOptions,
  sendStepEmail,
  type Option,
  type StepEmailRow,
  type StepOwner,
} from "@/lib/checklist-email-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MultiSearchSelect } from "@/components/multi-search-select";

/**
 * "Send email" por etapa do checklist — mesmo espírito visual do
 * `AttachedDocuments` (pill que expande em lista), reaproveitado nas 3 telas
 * de checklist (Order/Pre-loading/Shipment) porque a lógica de compor +
 * histórico é idêntica; só o `owner`/`feature` mudam por tela.
 *
 * O histórico carrega assim que a etapa expande (mesmo sem abrir a lista),
 * pra a contagem em "Emails sent" já aparecer certa de cara — igual ao pill
 * de "Attached documents" nunca mostra "…". A lista de destinatários, essa
 * sim, só carrega ao abrir o compositor (é maior e só serve pra quem vai
 * mandar um e-mail agora).
 */
export function StepEmailSection({
  owner,
  feature,
  defaultSubject,
  recordPath,
}: {
  owner: StepOwner;
  feature: "orders" | "pre_loading" | "shipments";
  defaultSubject: string;
  /** Caminho da tela de origem (ex: "/orders/<id>") — vira o botão "Go to" no
   *  e-mail, só pra destinatário interno (nunca pra `client`). */
  recordPath: string;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [history, setHistory] = useState<StepEmailRow[] | null>(null);
  const [recipientOptions, setRecipientOptions] = useState<Option[]>([]);
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    loadStepEmailHistory(owner).then(setHistory);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (composeOpen && recipientOptions.length === 0) {
      loadStepRecipientOptions().then(setRecipientOptions);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeOpen]);

  function openCompose() {
    setSubject(defaultSubject);
    setBody("");
    setRecipientIds([]);
    setComposeOpen(true);
  }

  function send() {
    if (recipientIds.length === 0) {
      toast.error("Select at least one recipient.");
      return;
    }
    if (!subject.trim() || !body.trim()) {
      toast.error("Write a subject and a message.");
      return;
    }
    startTransition(async () => {
      const res = await sendStepEmail(owner, {
        feature,
        recipient_ids: recipientIds,
        subject,
        body,
        recordPath,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.failed > 0
          ? `Sent to ${res.sent} of ${res.sent + res.failed} — check history for details.`
          : "E-mail sent."
      );
      setComposeOpen(false);
      setHistoryOpen(true);
      loadStepEmailHistory(owner).then(setHistory);
    });
  }

  const count = history?.length ?? null;

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={`flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition-colors ${
            count
              ? "border-emerald-600 bg-transparent text-emerald-700 hover:bg-emerald-50"
              : "border-transparent text-muted-foreground disabled:cursor-default"
          }`}
          disabled={count === 0}
          aria-expanded={count ? historyOpen : undefined}
          onClick={() => setHistoryOpen((o) => !o)}
        >
          <Mail className={`size-4 ${count ? "text-emerald-600" : "text-slate-400"}`} />
          Emails sent
          <span
            className={`rounded-md px-2 py-0.5 text-xs ${
              count ? "text-emerald-700" : "bg-slate-200 text-slate-600"
            }`}
          >
            {count ?? "…"}
          </span>
          {!!count && (
            <ChevronDown
              className={`size-3.5 text-emerald-600 transition-transform ${historyOpen ? "rotate-180" : ""}`}
            />
          )}
        </button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={openCompose}
        >
          <Send className="size-3.5" />
          Send email
        </Button>
      </div>

      {historyOpen && (history?.length ?? 0) > 0 && (
        <div className="mt-2 space-y-1.5">
          {history!.map((row) => (
            <EmailHistoryCard key={row.id} row={row} />
          ))}
        </div>
      )}

      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send email</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">To</Label>
              <MultiSearchSelect
                value={recipientIds}
                onChange={setRecipientIds}
                options={recipientOptions}
                placeholder="Choose recipients..."
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Subject</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Message</Label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                className="mt-1"
                placeholder="Write your message..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setComposeOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="button" onClick={send} disabled={pending}>
              <Send className="size-3.5" />
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmailHistoryCard({ row }: { row: StepEmailRow }) {
  const [open, setOpen] = useState(false);
  const failedCount = row.recipients.filter((r) => !r.ok).length;

  return (
    <div className="rounded-md bg-white px-3 py-2 text-sm">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-2 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span>
          <span className="font-medium text-slate-800">{row.subject}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {row.sender_name} · {formatDateTime(row.created_at)}
          </span>
        </span>
        <ChevronDown
          className={`mt-0.5 size-3.5 shrink-0 text-slate-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      <div className="mt-1 flex flex-wrap gap-1">
        {row.recipients.map((r) => (
          <span
            key={r.user_id}
            title={r.error ?? undefined}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${
              r.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
            }`}
          >
            <User className="size-3" />
            {r.name}
          </span>
        ))}
      </div>
      {open && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{row.body}</p>}
      {failedCount > 0 && (
        <p className="mt-1 text-xs text-rose-600">
          {failedCount} of {row.recipients.length} failed to deliver.
        </p>
      )}
    </div>
  );
}
