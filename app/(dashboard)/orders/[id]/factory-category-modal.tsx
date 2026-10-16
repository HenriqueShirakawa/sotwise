"use client";

import { useMemo, useState } from "react";

import { formatDateNumeric } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { BatchRow, OfcRow } from "./order-detail-client";

const PAGE_SIZE = 8;

/**
 * Factory x Category da Order — só consulta. Criar, excluir, importar CSV e
 * trocar uma entrada de lote saíram em 16/10/2026: quem cadastra e move é o
 * GSS, que manda pra gente pela API (/api/order-items, /api/batches).
 */
export function FactoryCategoryModal({
  open,
  onOpenChange,
  batches,
  ofc,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batches: BatchRow[];
  ofc: OfcRow[];
}) {
  const [page, setPage] = useState(0);

  const [syncedOpen, setSyncedOpen] = useState(false);
  if (open !== syncedOpen) {
    setSyncedOpen(open);
    if (open) setPage(0);
  }

  const batchNumberById = useMemo(
    () => new Map(batches.map((b) => [b.id, b.batch_number])),
    [batches]
  );

  // Ordem fixa: Batch No. → Category → Factory — o lote inteiro fica junto
  // (pedido do cliente, QA 25/09). Entrada sem lote vai pro fim; empate final
  // pelo Ship req.
  const sortedOfc = useMemo(
    () =>
      [...ofc].sort((a, b) => {
        const aBatch = batchNumberById.get(a.batch_id ?? "");
        const bBatch = batchNumberById.get(b.batch_id ?? "");
        if (aBatch !== bBatch) {
          if (aBatch === undefined) return 1;
          if (bBatch === undefined) return -1;
          const batchCmp = aBatch.localeCompare(bBatch, undefined, { numeric: true });
          if (batchCmp !== 0) return batchCmp;
        }
        const catCmp = a.category_name.localeCompare(b.category_name);
        if (catCmp !== 0) return catCmp;
        const facCmp = a.factory_name.localeCompare(b.factory_name);
        if (facCmp !== 0) return facCmp;
        return (a.ship_requirement ?? "").localeCompare(b.ship_requirement ?? "");
      }),
    [ofc, batchNumberById]
  );

  const totalPages = Math.max(1, Math.ceil(sortedOfc.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = sortedOfc.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-lg text-primary">Factory x Category</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-muted-foreground">
            Entries and batches are managed in the GSS.
          </p>

          <div className="overflow-hidden rounded-lg border">
            <div className="grid grid-cols-4 items-center gap-2 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
              <span>Category</span>
              <span>Factory</span>
              <span>Ship req.</span>
              <span>Batch No.</span>
            </div>
            {pageRows.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">No entries yet.</p>
            ) : (
              pageRows.map((r) => (
                <div
                  key={r.id}
                  className="grid grid-cols-4 items-center gap-2 border-t px-3 py-2 text-sm"
                >
                  <span className="truncate text-slate-700">{r.category_name}</span>
                  <span className="truncate text-slate-700">{r.factory_name}</span>
                  <span className="text-slate-700">{formatDateNumeric(r.ship_requirement)}</span>
                  <span className="truncate text-slate-700">
                    {batchNumberById.get(r.batch_id ?? "") ?? "—"}
                  </span>
                </div>
              ))
            )}
            {sortedOfc.length > PAGE_SIZE && (
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
            type="button"
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
