"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus } from "lucide-react";
import { toast } from "sonner";

import { formatDateNumeric, formatDateTime, todayIso } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/date-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  getStepRevisions,
  reviseStepCompletedOn,
  saveOrderReceivedDate,
  type StepRevision,
} from "./actions";

/**
 * Revisões das etapas Order / PO / PI (20/10/2026, lib/checklist-revisions).
 *
 * O campo mostra a data ORIGINAL e, ao lado, um número em destaque com quantas
 * revisões houve (`RevisionBadge`). Clicar abre o popup: no topo o "+" grava
 * uma data nova (motivo obrigatório depois da 1ª); abaixo, cada registro é um
 * item expansível com o detalhe — de → para, quando, quem (ou GSS), motivo e,
 * no PO, a lista de Factory × Category recebida com o que mudou.
 */

export type RevisionStep = "order" | "po" | "pi";

/** Número em destaque com a quantidade de revisões — clicável. */
export function RevisionBadge({ count, onClick }: { count: number; onClick: () => void }) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${count} revision${count === 1 ? "" : "s"} — view details`}
      title="View revisions"
      className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90"
    >
      {count}
    </button>
  );
}

const TITLES: Record<RevisionStep, string> = {
  order: "Order received date",
  po: "PO — Factory × Category",
  pi: "PI status",
};

const KIND_LABELS: Record<StepRevision["kind"], string> = {
  order_received_date: "Order received date",
  fxc: "Factory × Category received",
  pi_status: "PI status",
  completed_on: "Completed on",
};

type FxcItem = { factory: string; category: string };

export function StepRevisionsModal({
  open,
  onOpenChange,
  orderId,
  stepId,
  step,
  currentDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  stepId: string;
  step: RevisionStep;
  /** Order: received date vigente; PO/PI: Completed on. Vazio = 1º registro. */
  currentDate: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<StepRevision[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");

  // Zera o formulário a cada abertura; a lista recarrega no efeito abaixo (a
  // server action não pode ser chamada durante o render — ela mexe no Router).
  const [syncedFor, setSyncedFor] = useState<string | null>(null);
  const openFor = open ? stepId : null;
  if (openFor !== syncedFor) {
    setSyncedFor(openFor);
    setRows(null);
    setDate("");
    setReason("");
    // Order sem data ainda: o popup já abre no formulário.
    setAdding(step === "order" && !currentDate);
  }

  useEffect(() => {
    if (!openFor) return;
    let cancelled = false;
    getStepRevisions(openFor)
      .then((r) => !cancelled && setRows(r))
      .catch((err: unknown) => {
        if (cancelled) return;
        setRows([]);
        toast.error(err instanceof Error ? err.message : "Failed to load revisions.");
      });
    return () => {
      cancelled = true;
    };
  }, [openFor]);

  // Order grava a received date; PO/PI só revisam um Completed on que já existe
  // (o 1º preenchimento é o campo normal da etapa).
  const canAdd = step === "order" || !!currentDate;
  const reasonRequired = !!currentDate;
  const canSave = !!date && (!reasonRequired || reason.trim() !== "");

  function save() {
    startTransition(async () => {
      const res =
        step === "order"
          ? await saveOrderReceivedDate(orderId, date, reason.trim() || null)
          : await reviseStepCompletedOn(orderId, stepId, date, reason);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(currentDate ? "Revision saved." : "Order received date saved.");
      setAdding(false);
      setDate("");
      setReason("");
      router.refresh();
      setRows(await getStepRevisions(stepId));
    });
  }

  // Mais novo primeiro; o 1º registro de cada tipo é o "Original".
  const originalIds = new Set<string>();
  const seenKinds = new Set<string>();
  for (const r of rows ?? []) {
    if (r.kind !== "completed_on" && !seenKinds.has(r.kind)) {
      seenKinds.add(r.kind);
      originalIds.add(r.id);
    }
  }
  const ordered = [...(rows ?? [])].reverse();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg text-primary">{TITLES[step]}</DialogTitle>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          {canAdd && (
            <div className="rounded-lg bg-slate-50 p-4">
              {!adding ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-dashed bg-white"
                  onClick={() => setAdding(true)}
                >
                  <Plus className="size-4" />
                  {step === "order"
                    ? currentDate
                      ? "Revise order received date"
                      : "Set order received date"
                    : "Revise completion date"}
                </Button>
              ) : (
                <div className="space-y-3">
                  <div>
                    <Label className="text-foreground">
                      {step === "order" ? "Order received date" : "Completed on"}
                    </Label>
                    <DatePicker
                      value={date || null}
                      onChange={(v) => setDate(v ?? "")}
                      max={todayIso()}
                      className="mt-1.5 bg-white"
                    />
                  </div>
                  {reasonRequired && (
                    <div>
                      <Label className="text-foreground">Reason</Label>
                      <Textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Why is this date changing?"
                        className="mt-1.5 bg-white"
                        rows={3}
                      />
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1 bg-white"
                      disabled={pending}
                      onClick={() => setAdding(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      className="flex-1"
                      disabled={!canSave || pending}
                      onClick={save}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            {rows === null ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
            ) : ordered.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Nothing recorded yet.
              </p>
            ) : (
              ordered.map((r) => (
                <RevisionItem key={r.id} row={r} original={originalIds.has(r.id)} />
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RevisionItem({ row, original }: { row: StepRevision; original: boolean }) {
  const [open, setOpen] = useState(false);
  const who = row.source === "gss" ? "GSS" : (row.changed_by_name ?? "—");
  const status = typeof row.payload.status === "string" ? row.payload.status : null;
  const previousStatus =
    typeof row.payload.previous_status === "string" ? row.payload.previous_status : null;
  const items = (row.payload.items as FxcItem[] | undefined) ?? [];
  const added = (row.payload.added as FxcItem[] | undefined) ?? [];
  const removed = (row.payload.removed as FxcItem[] | undefined) ?? [];

  let summary: string;
  if (row.kind === "fxc") {
    summary = original
      ? `${items.length} entr${items.length === 1 ? "y" : "ies"}`
      : `+${added.length} / −${removed.length}`;
  } else if (row.kind === "pi_status") {
    summary = `${status ?? "—"} · ${formatDateNumeric(row.new_date)}`;
  } else {
    summary = original
      ? formatDateNumeric(row.new_date)
      : `${formatDateNumeric(row.previous_date)} → ${formatDateNumeric(row.new_date)}`;
  }

  return (
    <div className="rounded-lg border bg-white">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className={`shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium ${
            original ? "bg-slate-100 text-slate-600" : "bg-primary/10 text-primary"
          }`}
        >
          {original ? "Original" : "Revision"}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{summary}</span>
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
          {formatDateTime(row.changed_at)}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="space-y-2 border-t px-3 py-3 text-sm">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
            <Field label="Type">{KIND_LABELS[row.kind]}</Field>
            <Field label="When">{formatDateTime(row.changed_at)}</Field>
            <Field label="By">{who}</Field>
            {row.kind === "pi_status" && previousStatus && (
              <Field label="Previous status">
                {previousStatus} · {formatDateNumeric(row.previous_date)}
              </Field>
            )}
            {!original && row.kind !== "fxc" && row.kind !== "pi_status" && (
              <>
                <Field label="From">{formatDateNumeric(row.previous_date)}</Field>
                <Field label="To">{formatDateNumeric(row.new_date)}</Field>
              </>
            )}
          </dl>
          {row.reason && (
            <Field label="Reason">
              <span className="whitespace-pre-wrap">{row.reason}</span>
            </Field>
          )}
          {row.kind === "fxc" && (
            <div className="space-y-2">
              {!original && <FxcList title="Added" items={added} tone="text-emerald-700" />}
              {!original && <FxcList title="Removed" items={removed} tone="text-red-700" />}
              <FxcList title={original ? "Received" : "Full list after this delivery"} items={items} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-slate-800">{children}</dd>
    </div>
  );
}

function FxcList({ title, items, tone }: { title: string; items: FxcItem[]; tone?: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className={`text-xs font-medium ${tone ?? "text-muted-foreground"}`}>
        {title} ({items.length})
      </p>
      <ul className="mt-1 space-y-0.5">
        {items.map((i, idx) => (
          <li key={`${i.factory}-${i.category}-${idx}`} className="text-slate-700">
            {i.factory} <span className="text-muted-foreground">·</span> {i.category}
          </li>
        ))}
      </ul>
    </div>
  );
}
