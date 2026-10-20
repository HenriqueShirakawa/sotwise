"use client";

import { useEffect, useState } from "react";
import { FileClock } from "lucide-react";

import { formatDateNumeric, formatDateTime } from "@/lib/format";
import type { StepOwner } from "@/lib/checklist-email-actions";
import {
  loadStepLog,
  loadStepLogCounts,
  type StepLogChange,
  type StepLogEntry,
  type StepLogScope,
} from "@/lib/checklist-step-log-actions";
import type { ChecklistStep } from "@/types/database";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * "History" por etapa do checklist (20/10/2026) — log de toda alteração que um
 * usuário fez na etapa (campos, anexos, auto-conclusão, Confirm Shipping), nas
 * 3 telas.
 *
 * Fica no CABEÇALHO da etapa, ao lado do chevron: só ícone + quantidade; o
 * detalhe abre num popup (pedido do usuário, 20/10 — o bloco dentro da etapa,
 * junto do "Emails sent", poluía demais).
 */

/**
 * Contador de History de todas as etapas da tela, numa consulta só.
 * `refreshKey` muda quando o checklist muda (save → revalidate) — aí recarrega.
 */
export function useStepLogCounts(
  scope: StepLogScope,
  refreshKey: string
): Partial<Record<ChecklistStep, number>> {
  const [counts, setCounts] = useState<Partial<Record<ChecklistStep, number>>>({});
  const scopeKey = JSON.stringify(scope);
  useEffect(() => {
    let cancelled = false;
    loadStepLogCounts(JSON.parse(scopeKey) as StepLogScope)
      .then((c) => !cancelled && setCounts(c))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [scopeKey, refreshKey]);
  return counts;
}

/** Ícone + quantidade no cabeçalho da etapa; clicar abre o popup. Sem log, some. */
export function StepLogButton({
  owner,
  count,
  stepLabel,
}: {
  owner: StepOwner;
  count: number | undefined;
  stepLabel: string;
}) {
  const [open, setOpen] = useState(false);
  if (!count) return null;
  return (
    <>
      {/* Mesmo pill de antes (quando ficava dentro da etapa), agora no cabeçalho. */}
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-2.5 py-0.5 text-xs text-slate-700 transition-colors hover:bg-slate-50"
        aria-label={`History (${count})`}
        onClick={() => setOpen(true)}
      >
        <FileClock className="size-3.5 text-slate-600" />
        History
        <span className="text-slate-700">{count}</span>
      </button>
      {open && (
        <StepLogDialog owner={owner} stepLabel={stepLabel} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function StepLogDialog({
  owner,
  stepLabel,
  onClose,
}: {
  owner: StepOwner;
  stepLabel: string;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<StepLogEntry[] | null>(null);
  const ownerKey = JSON.stringify(owner);

  useEffect(() => {
    let cancelled = false;
    loadStepLog(JSON.parse(ownerKey) as StepOwner)
      .then((rows) => !cancelled && setEntries(rows))
      .catch(() => !cancelled && setEntries([]));
    return () => {
      cancelled = true;
    };
  }, [ownerKey]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-lg text-primary">History · {stepLabel}</DialogTitle>
        </DialogHeader>
        {entries === null ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No changes yet.</p>
        ) : (
          <ol className="space-y-1.5">
            {entries.map((entry) => (
              <LogCard key={entry.id} entry={entry} />
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

const ACTION_BADGES: Partial<Record<StepLogEntry["action"], string>> = {
  auto_complete: "Auto-completed",
  confirm_shipping: "Confirm Shipping",
};

function LogCard({ entry }: { entry: StepLogEntry }) {
  const badge = ACTION_BADGES[entry.action];
  return (
    <li className="rounded-md border bg-white px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-slate-800">{entry.actor_name}</span>
        <span>{formatDateTime(entry.created_at)}</span>
        {badge && (
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
            {badge}
          </span>
        )}
      </div>
      {entry.action === "attachment_added" || entry.action === "attachment_removed" ? (
        <p className="mt-1 text-slate-700">
          {entry.action === "attachment_added" ? "Attached " : "Removed "}
          <span className="font-medium">{entry.file_name ?? "a document"}</span>
          {entry.factory_name && (
            <span className="text-muted-foreground"> · {entry.factory_name}</span>
          )}
        </p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {entry.changes.map((c) => (
            <li key={c.field} className="text-slate-700">
              <span className="text-muted-foreground">{c.label}:</span>{" "}
              {/* Campo que estava vazio: só o valor novo, sem "— →". */}
              {c.from !== null && (
                <>
                  <span className="text-slate-500">{show(c, c.from)}</span>
                  {" → "}
                </>
              )}
              <span className="font-medium">{show(c, c.to)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function show(change: StepLogChange, value: string | null): string {
  if (value === null) return "—";
  return change.kind === "date" ? formatDateNumeric(value) : value;
}
