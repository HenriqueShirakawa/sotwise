"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { LoadingStatus } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Uma entrada Factory×Category do lote (order_factory_category). */
export type PartRow = {
  id: string;
  factory: string;
  category: string;
  loading_status: LoadingStatus | null;
};

const STATUS_LABELS: Record<LoadingStatus, string> = {
  total: "Total",
  partial: "Partial",
  none: "None",
};

const ROWS_PER_PAGE = 8;

/**
 * "View parts": o que foi carregado por entrada Factory × Category do lote.
 * SOMENTE LEITURA — o status Total/Partial/None é definido no Confirm Shipping
 * e não se edita depois. (O Bubble deixava editar, mas mudar aqui bagunçaria o
 * split de lotes já feito na confirmação — ver docs §3.7.2/§3.10.3.)
 */
export function ViewPartsModal({
  open,
  onOpenChange,
  poBatch,
  parts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  poBatch: string;
  parts: PartRow[];
}) {
  const [page, setPage] = useState(0);

  // Volta pra primeira página a cada abertura.
  const [syncedOpen, setSyncedOpen] = useState(false);
  if (open !== syncedOpen) {
    setSyncedOpen(open);
    if (open) setPage(0);
  }

  const pageCount = Math.max(Math.ceil(parts.length / ROWS_PER_PAGE), 1);
  const pageIndex = Math.min(page, pageCount - 1);
  const pageRows = parts.slice(pageIndex * ROWS_PER_PAGE, (pageIndex + 1) * ROWS_PER_PAGE);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg text-primary">View parts</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <section className="space-y-4">
            <p className="border-b pb-2 text-sm text-muted-foreground">Loaded parts</p>
            <div>
              <Label className="text-foreground">PO number</Label>
              <Input value={poBatch} readOnly disabled className="mt-1.5 bg-muted" />
            </div>
          </section>

          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50/80 text-xs font-semibold text-slate-500">
                  <th className="px-4 py-3 text-left font-semibold">Factory</th>
                  <th className="px-4 py-3 text-left font-semibold">Category</th>
                  <th className="px-4 py-3 text-left font-semibold">Part</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="h-20 text-center text-muted-foreground">
                      No Factory × Category entries for this batch.
                    </td>
                  </tr>
                ) : (
                  pageRows.map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="px-4 py-3">{p.factory}</td>
                      <td className="px-4 py-3">{p.category}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {p.loading_status ? (
                          STATUS_LABELS[p.loading_status]
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Page {pageIndex + 1} of {pageCount}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="rounded-lg"
                onClick={() => setPage(pageIndex - 1)}
                disabled={pageIndex === 0}
                aria-label="Previous page"
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="rounded-lg"
                onClick={() => setPage(pageIndex + 1)}
                disabled={pageIndex >= pageCount - 1}
                aria-label="Next page"
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button className="sm:min-w-32" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
