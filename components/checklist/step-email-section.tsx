"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronDown, Mail, Send, User, X } from "lucide-react";
import { toast } from "sonner";

import { formatDateTime } from "@/lib/format";
import {
  loadStepEmailDefaults,
  loadStepEmailHistory,
  loadStepRecipientOptions,
  markEmailReplyRead,
  previewStepEmail,
  sendStepEmail,
  type Option,
  type StepEmailPreview,
  type StepEmailRow,
  type StepOwner,
} from "@/lib/checklist-email-actions";
import { buildDefaultStepBody } from "@/lib/email/step-templates";
import type { ChecklistStep, EmailLanguage } from "@/types/database";
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
 *
 * Multi-idioma (Fase 15/09/2026): um Pre-loading/Shipment pode consolidar
 * clientes de idiomas diferentes — o compositor abre uma ABA por idioma só
 * quando isso acontece de verdade (`languages.length > 1`); pra Order e pra
 * PL de idioma único (o caso comum) não existe aba nenhuma, é a mesma caixa
 * única de sempre. Cada aba é 100% independente e WYSIWYG — o que estiver
 * escrita nela é o que sai pra quem é daquele idioma (ver `sendStepEmail`).
 */
const LANGUAGE_LABELS: Record<EmailLanguage, string> = {
  en: "English",
  "pt-BR": "Brazilian Portuguese",
  zh: "Simplified Chinese",
};

/** Rótulo curto pras abas de idioma do compositor (pill acima do textarea) —
 *  o nome por extenso (`LANGUAGE_LABELS`) fica só pras frases corridas do
 *  aviso âmbar, onde "Brazilian Portuguese tab" lê melhor que "pt-br tab". */
const LANGUAGE_TAB_LABELS: Record<EmailLanguage, string> = {
  en: "View en",
  "pt-BR": "View pt-br",
  zh: "View zh",
};

/** Qual variante a tela de preview está mostrando — "internal" ou o idioma
 *  de uma das variantes de cliente presentes. */
type PreviewTab = "internal" | EmailLanguage;

export function StepEmailSection({
  owner,
  feature,
  step,
  defaultSubject,
  recordPath,
  responsibleId,
  done,
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
  /** A etapa está "Checked" (bolinha verde, `isStepChecked` de
   *  `lib/checklist-completion.ts`) agora? Pra detectar a TRANSIÇÃO pra
   *  concluída e abrir o compositor sozinho (ver `useEffect` abaixo) — não é
   *  usado pra mais nada aqui. */
  done: boolean;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [stage, setStage] = useState<"compose" | "preview">("compose");
  const [preview, setPreview] = useState<StepEmailPreview | null>(null);
  const [previewVariant, setPreviewVariant] = useState<PreviewTab>("internal");
  const [previewHeight, setPreviewHeight] = useState(240);
  const [history, setHistory] = useState<StepEmailRow[] | null>(null);
  const [recipientOptions, setRecipientOptions] = useState<Option[]>([]);
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  /** E-mails digitados à mão (gente sem cadastro no SOTWISE). */
  const [adHocEmails, setAdHocEmails] = useState<string[]>([]);
  const [adHocDraft, setAdHocDraft] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  /** Uma entrada por idioma relevante pra esta etapa — a maioria das vezes
   *  só 1 (`languages.length === 1`). */
  const [bodies, setBodies] = useState<Partial<Record<EmailLanguage, string>>>({});
  const [languages, setLanguages] = useState<EmailLanguage[]>(["en"]);
  const [activeLanguage, setActiveLanguage] = useState<EmailLanguage>("en");
  /** Idioma que a equipe interna e os avulsos sempre recebem — sempre
   *  `languages[0]` (ver `resolveClientLanguageGroups`). */
  const [primaryLanguage, setPrimaryLanguage] = useState<EmailLanguage>("en");
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
    setBodies({ en: buildDefaultStepBody(step, {}) });
    setLanguages(["en"]);
    setActiveLanguage("en");
    setPrimaryLanguage("en");
    setRecipientIds(responsibleId ? [responsibleId] : []);
    setAdHocEmails([]);
    setAdHocDraft("");
    setStage("compose");
    setPreview(null);
    setComposeOpen(true);
    // Corpo padrão nasce em inglês com os colchetes originais e troca pro
    // texto/idioma de verdade assim que resolver — evita segurar a abertura
    // do modal numa ida ao banco. Roda de novo toda vez que abre (o
    // cliente/usuário pode mudar). Uma aba por idioma que a etapa resolve —
    // só vira abas visíveis de verdade quando há mais de 1 (ver JSX abaixo).
    loadStepEmailDefaults(owner).then(({ senderName, groups }) => {
      const nextBodies: Partial<Record<EmailLanguage, string>> = {};
      for (const group of groups) {
        nextBodies[group.language] = buildDefaultStepBody(
          step,
          { customerName: group.customerName, senderName },
          group.language
        );
      }
      setBodies(nextBodies);
      setLanguages(groups.map((g) => g.language));
      setPrimaryLanguage(groups[0].language);
      setActiveLanguage(groups[0].language);
    });
  }

  /** Etapa que acabou de virar "Checked" (verde) abre o compositor sozinha —
   *  só isso, nunca manda nada por conta própria (decisão do usuário em
   *  16/09/2026). Dispara numa transição de verdade DEPOIS do mount (o `ref`
   *  nasce com o `done` de agora, então a 1ª rodada do efeito nunca vê
   *  mudança) — nunca na carga inicial da tela, mesmo se a etapa já chegar
   *  concluída. Mesma trava do botão manual: sem Responsible, não abre. */
  const wasDoneRef = useRef(done);
  useEffect(() => {
    if (!wasDoneRef.current && done && responsibleId) {
      openCompose();
    }
    wasDoneRef.current = done;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  const canSend =
    !pending &&
    recipientIds.length > 0 &&
    !!subject.trim() &&
    languages.every((lang) => !!bodies[lang]?.trim());

  /** Valida e adiciona o e-mail digitado à lista de avulsos. Silencioso
   *  quando o campo está vazio (Enter sem nada digitado não é erro). */
  function addAdHocEmail() {
    const email = adHocDraft.trim().toLowerCase();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Invalid e-mail address.");
      return;
    }
    if (!adHocEmails.includes(email)) setAdHocEmails([...adHocEmails, email]);
    setAdHocDraft("");
  }

  function showPreview() {
    if (!canSend) {
      if (recipientIds.length === 0) toast.error("Select at least one recipient.");
      else toast.error("Write a subject and a message for every language tab.");
      return;
    }
    startTransition(async () => {
      const res = await previewStepEmail(owner, {
        feature,
        recipient_ids: recipientIds,
        ad_hoc_emails: adHocEmails,
        subject,
        bodies,
        recordPath,
        step,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setPreview(res.preview);
      setPreviewVariant(res.preview.clientVariants[0]?.language ?? "internal");
      setPreviewHeight(240);
      setStage("preview");
    });
  }

  function send() {
    startTransition(async () => {
      const res = await sendStepEmail(owner, {
        feature,
        recipient_ids: recipientIds,
        ad_hoc_emails: adHocEmails,
        subject,
        bodies,
        recordPath,
        step,
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

  const previewVariantCount = (preview?.internalHtml ? 1 : 0) + (preview?.clientVariants.length ?? 0);
  const activePreviewHtml =
    previewVariant === "internal"
      ? preview?.internalHtml
      : preview?.clientVariants.find((v) => v.language === previewVariant)?.html;

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
              {languages.length === 1 && primaryLanguage !== "en" && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  This client&apos;s default language is {LANGUAGE_LABELS[primaryLanguage]}. The message below
                  was pre-filled in {LANGUAGE_LABELS[primaryLanguage]} and is exactly what gets sent — to the
                  client and the internal team — so edit it like any other message.
                </p>
              )}
              {languages.length > 1 && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {languages.length} languages here — each tab sends a separate e-mail to only
                  that language&apos;s clients (with their order&apos;s thread). Ad-hoc recipients
                  and the internal team always go in the {LANGUAGE_LABELS[primaryLanguage]} tab.
                </p>
              )}
              <div>
                <Label className="text-xs text-muted-foreground">To</Label>
                <MultiSearchSelect
                  value={recipientIds}
                  onChange={setRecipientIds}
                  options={recipientOptions}
                  placeholder="Choose recipients..."
                  lockedIds={responsibleId ? [responsibleId] : []}
                />
                {/* Destinatário sem cadastro no SOTWISE. Controle próprio, de
                    propósito: o MultiSearchSelect é compartilhado com outras 5
                    telas que não têm nada a ver com e-mail. Quem entra por
                    aqui recebe SEMPRE a versão de cliente (sem campos
                    internos/botão "Acessar") — não há perfil pra checar papel. */}
                <div className="mt-1.5 flex gap-1.5">
                  <Input
                    value={adHocDraft}
                    onChange={(e) => setAdHocDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        addAdHocEmail();
                      }
                    }}
                    onBlur={addAdHocEmail}
                    type="email"
                    placeholder="Add an e-mail not registered in the system..."
                    className="h-8 text-xs"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={addAdHocEmail}>
                    Add
                  </Button>
                </div>
                {adHocEmails.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {adHocEmails.map((email) => (
                      <span
                        key={email}
                        className="inline-flex items-center gap-1 rounded-full bg-[#640BB7]/10 px-2 py-0.5 text-xs text-[#640BB7]"
                      >
                        {email}
                        <button
                          type="button"
                          aria-label={`Remove ${email}`}
                          onClick={() => setAdHocEmails(adHocEmails.filter((e) => e !== email))}
                          className="text-[#640BB7]/60 hover:text-[#640BB7]"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
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
                {languages.length > 1 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {languages.map((lang) => (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => setActiveLanguage(lang)}
                        className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                          activeLanguage === lang
                            ? "border-[#640BB7] bg-[#640BB7] text-white"
                            : "border-input bg-transparent text-muted-foreground hover:bg-slate-50"
                        }`}
                      >
                        {LANGUAGE_TAB_LABELS[lang]}
                      </button>
                    ))}
                  </div>
                )}
                <Textarea
                  value={bodies[activeLanguage] ?? ""}
                  onChange={(e) => setBodies((prev) => ({ ...prev, [activeLanguage]: e.target.value }))}
                  rows={6}
                  className="mt-1.5"
                  placeholder="Write your message..."
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {feature !== "orders" && (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-muted-foreground">
                  Showing as it will appear in one order&apos;s own thread — each order this record
                  consolidates gets its own separate reply.
                </p>
              )}
              {previewVariantCount > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {preview?.internalHtml && (
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
                  )}
                  {preview?.clientVariants.map((variant) => (
                    <button
                      key={variant.language}
                      type="button"
                      onClick={() => setPreviewVariant(variant.language)}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        previewVariant === variant.language
                          ? "border-[#640BB7] bg-[#640BB7] text-white"
                          : "border-input bg-transparent text-muted-foreground hover:bg-slate-50"
                      }`}
                    >
                      {(preview?.clientVariants.length ?? 0) > 1
                        ? `Client view (${LANGUAGE_LABELS[variant.language]})`
                        : "Client view"}
                    </button>
                  ))}
                </div>
              )}
              <div className="max-h-[640px] overflow-y-auto rounded-md border">
                <iframe
                  title="Email preview"
                  sandbox="allow-same-origin"
                  srcDoc={activePreviewHtml ?? preview?.internalHtml ?? preview?.clientVariants[0]?.html ?? ""}
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
          {row.order_po_number && (
            <span className="ml-2 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
              Order #{row.order_po_number}
            </span>
          )}
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
            key={r.user_id ?? r.email}
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
              {/* Resposta que chegou sem cabeçalho de thread utilizável: o
                  webhook a prendeu à etapa mais recente da conversa por
                  falta de opção melhor — a tela avisa em vez de fingir. */}
              {r.attribution === "fallback" && (
                <p className="mt-1 text-[11px] italic text-amber-700">
                  Exact step not confirmed — this reply was attached to the latest e-mail in the order&apos;s conversation.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
