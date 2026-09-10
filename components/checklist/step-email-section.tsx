"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronDown, Mail, Send, User } from "lucide-react";
import { toast } from "sonner";

import { formatDateTime } from "@/lib/format";
import {
  loadStepEmailHistory,
  loadStepRecipientOptions,
  markEmailReplyRead,
  previewStepEmail,
  resolveStepEmailLanguage,
  sendStepEmail,
  type Option,
  type StepEmailPreview,
  type StepEmailRow,
  type StepOwner,
} from "@/lib/checklist-email-actions";
import { buildDefaultStepBody, stepHasTemplate } from "@/lib/email/step-templates";
import type { ChecklistStep } from "@/types/database";
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
  step,
  defaultSubject,
  recordPath,
  responsibleId,
}: {
  owner: StepOwner;
  feature: "orders" | "pre_loading" | "shipments";
  /** Etapa do checklist (ex: "pi") — só pra escolher o template padrão do
   *  corpo (ver `lib/email/step-templates.ts`); roteamento por `owner`. */
  step: ChecklistStep;
  defaultSubject: string;
  /** Caminho da tela de origem (ex: "/orders/<id>") — vira o botão "Go to" no
   *  e-mail, só pra destinatário interno (nunca pra `client`). */
  recordPath: string;
  /** `responsible_id` da própria etapa (campo "Responsible" já editável na
   *  tela). Fase 2.1 — User Story 2: vira destinatário âncora obrigatório do
   *  e-mail — sem ele, nem abre o compositor. */
  responsibleId: string | null;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [stage, setStage] = useState<"compose" | "preview">("compose");
  const [preview, setPreview] = useState<StepEmailPreview | null>(null);
  const [previewVariant, setPreviewVariant] = useState<"client" | "internal">("client");
  const [previewHeight, setPreviewHeight] = useState(240);
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
    setBody(stepHasTemplate(step) ? buildDefaultStepBody(step, "en") : "");
    setRecipientIds(responsibleId ? [responsibleId] : []);
    setStage("compose");
    setPreview(null);
    setComposeOpen(true);
    // Corpo padrão nasce em inglês (acima) e sobe pro idioma do cliente assim
    // que resolver — evita segurar a abertura do modal numa ida ao banco.
    if (stepHasTemplate(step)) {
      resolveStepEmailLanguage(owner).then((language) => setBody(buildDefaultStepBody(step, language)));
    }
  }

  const canSend = !pending && recipientIds.length > 0 && !!subject.trim() && !!body.trim();

  function showPreview() {
    if (!canSend) {
      if (recipientIds.length === 0) toast.error("Select at least one recipient.");
      else toast.error("Write a subject and a message.");
      return;
    }
    startTransition(async () => {
      const res = await previewStepEmail(owner, {
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
      setPreview(res.preview);
      setPreviewVariant(res.preview.clientHtml ? "client" : "internal");
      setPreviewHeight(240);
      setStage("preview");
    });
  }

  function send() {
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
        loadStepEmailHistory(owner).then(setHistory);
        return;
      }
      // Falha parcial NÃO fecha o modal — os dados (destinatários/assunto/
      // corpo) continuam preenchidos pra tentar de novo sem redigitar tudo.
      if (res.failed > 0) {
        toast.error(`Sent to ${res.sent} of ${res.sent + res.failed} — check history for details.`);
        loadStepEmailHistory(owner).then(setHistory);
        return;
      }
      toast.success("E-mail sent.");
      setComposeOpen(false);
      setHistoryOpen(true);
      loadStepEmailHistory(owner).then(setHistory);
    });
  }

  const count = history?.length ?? null;
  const unreadReplies = history?.reduce((n, row) => n + row.replies.filter((r) => !r.read_by_me).length, 0) ?? 0;

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
          <span className="relative">
            <Mail className={`size-4 ${count ? "text-emerald-600" : "text-slate-400"}`} />
            {unreadReplies > 0 && (
              <span className="absolute -top-1 -right-1 size-2 rounded-full bg-rose-500" />
            )}
          </span>
          Emails sent
          <span
            className={`rounded-md px-2 py-0.5 text-xs ${
              count ? "text-emerald-700" : "bg-slate-200 text-slate-600"
            }`}
          >
            {count ?? "…"}
          </span>
          {unreadReplies > 0 && (
            <span className="rounded-md bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
              {unreadReplies} new {unreadReplies === 1 ? "reply" : "replies"}
            </span>
          )}
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
          disabled={!responsibleId}
          title={responsibleId ? undefined : "Set a Responsible for this step first"}
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
            <DialogTitle>{stage === "compose" ? "Send email" : "Review before sending"}</DialogTitle>
          </DialogHeader>
          {stage === "compose" ? (
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">To</Label>
                <MultiSearchSelect
                  value={recipientIds}
                  onChange={setRecipientIds}
                  options={recipientOptions}
                  placeholder="Choose recipients..."
                  lockedIds={responsibleId ? [responsibleId] : []}
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
          ) : (
            <div className="space-y-2">
              {preview?.clientHtml && preview?.internalHtml && (
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPreviewVariant("client")}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      previewVariant === "client"
                        ? "border-[#640BB7] bg-[#640BB7] text-white"
                        : "border-input bg-transparent text-muted-foreground hover:bg-slate-50"
                    }`}
                  >
                    Client view
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewVariant("internal")}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      previewVariant === "internal"
                        ? "border-[#640BB7] bg-[#640BB7] text-white"
                        : "border-input bg-transparent text-muted-foreground hover:bg-slate-50"
                    }`}
                  >
                    Internal view
                  </button>
                </div>
              )}
              <div className="max-h-[640px] overflow-y-auto rounded-md border">
                <iframe
                  title="Email preview"
                  sandbox="allow-same-origin"
                  srcDoc={
                    (previewVariant === "client" ? preview?.clientHtml : preview?.internalHtml) ??
                    preview?.clientHtml ??
                    preview?.internalHtml ??
                    ""
                  }
                  onLoad={(e) => {
                    // Sem `allow-scripts` no sandbox — só lê o DOM (mesmo
                    // HTML que a gente gerou) pra encaixar a altura no card
                    // de verdade, sem sobra do fundo #f4f2f8 do template
                    // embaixo. O CORTE de e-mail muito longo (a etapa PI,
                    // bilíngue, passa de 1700px) é do DIV pai (`overflow-y`) —
                    // CSS do pai não controla overflow interno de um iframe,
                    // só o próprio `scrolling`, por isso o iframe nunca tem
                    // scroll dele mesmo (`scrolling="no"`, sempre do tamanho
                    // exato do conteúdo).
                    const doc = e.currentTarget.contentWindow?.document;
                    const contentHeight = doc?.body?.scrollHeight;
                    if (contentHeight) setPreviewHeight(Math.max(contentHeight + 2, 200));
                  }}
                  scrolling="no"
                  style={{ height: previewHeight, display: "block" }}
                  className="w-full border-0"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            {stage === "compose" ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setComposeOpen(false)}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button type="button" onClick={showPreview} disabled={!canSend}>
                  <Send className="size-3.5" />
                  Preview
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => setStage("compose")} disabled={pending}>
                  Back
                </Button>
                <Button type="button" onClick={send} disabled={pending}>
                  <Send className="size-3.5" />
                  Confirm & send
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmailHistoryCard({ row }: { row: StepEmailRow }) {
  const [open, setOpen] = useState(false);
  const [locallyRead, setLocallyRead] = useState<Set<string>>(new Set());
  const failedCount = row.recipients.filter((r) => !r.ok).length;
  const unreadReplies = row.replies.filter((r) => !r.read_by_me && !locallyRead.has(r.id));

  function toggle() {
    if (!open && unreadReplies.length > 0) {
      setLocallyRead((prev) => new Set([...prev, ...unreadReplies.map((r) => r.id)]));
      for (const r of unreadReplies) void markEmailReplyRead(r.id);
    }
    setOpen(!open);
  }

  return (
    <div className="rounded-md bg-white px-3 py-2 text-sm">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-2 text-left"
        onClick={toggle}
      >
        <span>
          <span className="font-medium text-slate-800">{row.subject}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {row.sender_name} · {formatDateTime(row.created_at)}
          </span>
          {unreadReplies.length > 0 && (
            <span className="ml-2 rounded-md bg-rose-50 px-1.5 py-0.5 text-xs font-medium text-rose-700">
              {unreadReplies.length} new {unreadReplies.length === 1 ? "reply" : "replies"}
            </span>
          )}
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
      {open && row.replies.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-2">
          <p className="text-xs font-medium text-slate-500">Replies</p>
          {row.replies.map((r) => (
            <div key={r.id} className="rounded-md bg-slate-50 px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1 text-xs font-medium text-slate-700">
                  <User className="size-3" />
                  {r.from_name ?? r.from_email}
                </span>
                <span className="text-xs text-slate-400">{formatDateTime(r.received_at)}</span>
              </div>
              {/* Texto puro só — nunca renderiza HTML de e-mail externo cru. */}
              <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{r.body_text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
