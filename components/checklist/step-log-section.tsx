"use client";

import { useEffect, useState } from "react";
import { ChevronDown, History } from "lucide-react";

import { formatDateNumeric, formatDateTime } from "@/lib/format";
import type { StepOwner } from "@/lib/checklist-email-actions";
import {
  loadStepLog,
  type StepLogChange,
  type StepLogEntry,
} from "@/lib/checklist-step-log-actions";

/**
 * "History" por etapa do checklist (20/10/2026) — log de toda alteração que um
 * usuário fez na etapa (campos, anexos, auto-conclusão, Confirm Shipping), nas
 * 3 telas. Mesmo pill expansível de "Emails sent" (`StepEmailSection`).
 *
 * `refreshKey` muda quando a etapa muda na tela (save → revalidate traz os
 * dados novos) — aí o log recarrega sozinho, sem F5.
 */
export function StepLogSection({ owner, refreshKey }: { owner: StepOwner; refreshKey: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<StepLogEntry[] | null>(null);
  const ownerKey = JSON.stringify(owner);

  useEffect(() => {
    let cancelled = false;
    loadStepLog(JSON.parse(ownerKey) as StepOwner).then((rows) => {
      if (!cancelled) setEntries(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [ownerKey, refreshKey]);

  const count = entries?.length ?? null;

  return (
    <div>
      <button
        type="button"
        className={`flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition-colors ${
          count
            ? "border-slate-400 bg-transparent text-slate-700 hover:bg-slate-50"
            : "border-transparent text-muted-foreground disabled:cursor-default"
        }`}
        disabled={!count}
        aria-expanded={count ? open : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <History className={`size-4 ${count ? "text-slate-600" : "text-slate-400"}`} />
        History
        <span
          className={`rounded-md px-2 py-0.5 text-xs ${
            count ? "text-slate-700" : "bg-slate-200 text-slate-600"
          }`}
        >
          {count ?? "…"}
        </span>
        {!!count && (
          <ChevronDown
            className={`size-3.5 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {open && entries && entries.length > 0 && (
        <ol className="mt-2 space-y-1.5">
          {entries.map((entry) => (
            <LogCard key={entry.id} entry={entry} />
          ))}
        </ol>
      )}
    </div>
  );
}

const ACTION_BADGES: Partial<Record<StepLogEntry["action"], string>> = {
  auto_complete: "Auto-completed",
  confirm_shipping: "Confirm Shipping",
};

function LogCard({ entry }: { entry: StepLogEntry }) {
  const badge = ACTION_BADGES[entry.action];
  return (
    <li className="rounded-md bg-white px-3 py-2 text-sm">
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
