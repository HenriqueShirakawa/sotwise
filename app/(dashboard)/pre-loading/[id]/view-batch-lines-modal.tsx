"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { formatDateNumeric } from "@/lib/format";
import { BATCH_STATUS_LABELS } from "@/lib/status-colors";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { PlBatchRow } from "./pl-checklist-client";
import type { ShipmentLine } from "./confirm-shipping-modal";

const PAGE_SIZE = 8;

/** Rótulo que só aparece no mobile (a linha vira card). */
function SmallField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase sm:hidden">
        {label}
      </p>
      <div className="mt-0.5 sm:mt-0">{children}</div>
    </div>
  );
}

/**
 * Popup do "olho" na lista de lotes do Pre-Loading: mostra as linhas
 * (Factory × Category) daquele lote. Read-only — as `lines` já vêm carregadas
 * na página; aqui só filtramos por lote e paginamos.
 */
export function ViewBatchLinesModal({
  open,
  onOpenChange,
  batch,
  lines,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batch: PlBatchRow | null;
  /** Já filtradas pelo lote selecionado. */
  lines: ShipmentLine[];
}) {
  const [page, setPage] = useState(0);

  // Zera a paginação ao trocar de lote (ajuste de estado no render, padrão dos
  // modais do repo — evita um render a mais com a página errada).
  const openFor = open ? (batch?.id ?? null) : null;
  const [syncedFor, setSyncedFor] = useState<string | null>(null);
  if (openFor !== syncedFor) {
    setSyncedFor(openFor);
    setPage(0);
  }

  const sorted = [...lines].sort(
    (a, b) => a.category.localeCompare(b.category) || a.factory.localeCompare(b.factory)
  );
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg text-primary">Batch lines</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Client</p>
              <p className="mt-0.5 truncate font-medium text-slate-800">
                {batch?.client ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Order . Batch</p>
              <p className="mt-0.5 font-medium text-slate-800">
                {batch?.po_number} {batch?.batch_number}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <div className="mt-0.5">
                {batch ? <StatusPill label={BATCH_STATUS_LABELS[batch.status]} /> : null}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border">
            <div className="hidden grid-cols-[1fr_1fr_1fr] gap-x-3 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500 sm:grid">
              <span>Category</span>
              <span>Factory</span>
              <span>Ship req.</span>
            </div>
            {pageRows.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                No lines for this batch.
              </p>
            ) : (
              pageRows.map((l) => (
                <div
                  key={l.id}
                  className="grid grid-cols-2 gap-x-3 gap-y-2 border-t px-3 py-2.5 text-sm sm:grid-cols-[1fr_1fr_1fr] sm:gap-y-0"
                >
                  <SmallField label="Category">
                    <span className="block truncate text-slate-700">{l.category}</span>
                  </SmallField>
                  <SmallField label="Factory">
                    <span className="block truncate text-slate-700">{l.factory}</span>
                  </SmallField>
                  <SmallField label="Ship req.">
                    <span className="text-slate-700">
                      {l.ship_requirement ? formatDateNumeric(l.ship_requirement) : "—"}
                    </span>
                  </SmallField>
                </div>
              ))
            )}
            {sorted.length > PAGE_SIZE && (
              <div className="flex items-center justify-between border-t px-3 py-2 text-sm text-muted-foreground">
                <span>
                  Page {safePage + 1} of {totalPages}
                </span>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    disabled={safePage === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    ←
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    disabled={safePage >= totalPages - 1}
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  >
                    →
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="sm:min-w-32"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
