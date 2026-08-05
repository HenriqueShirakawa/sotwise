"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, SquareArrowOutUpRight } from "lucide-react";

import type { LoadingStatus } from "@/types/database";
import { formatDateNumeric } from "@/lib/format";
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
import { EtdOrderModal } from "@/app/(dashboard)/etd-factories/etd-modal";
import type { Ref } from "@/app/(dashboard)/orders/[id]/order-detail-client";

/** Uma entrada Factory×Category do lote (order_factory_category). */
export type PartRow = {
  id: string;
  /** Dono da entrada — o modal de ETD é montado por Order. */
  order_id: string;
  factory: string;
  category: string;
  loading_status: LoadingStatus | null;
  /** ETD initial date da entrada; o ↗ abre o ETD completo + histórico. */
  etd_initial: string | null;
  /**
   * Lote para onde a entrada migrou no split (Partial/None). Null = a entrada
   * segue no lote que embarcou (Total).
   */
  moved_to: string | null;
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
  factories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  poBatch: string;
  parts: PartRow[];
  /** Fábricas do cadastro — o modal de ETD usa no campo Dispatch location. */
  factories: Ref[];
}) {
  const [page, setPage] = useState(0);
  const [etdTarget, setEtdTarget] = useState<PartRow | null>(null);

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
    <>
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
                    <th className="px-4 py-3 text-left font-semibold">ETD</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="h-20 text-center text-muted-foreground">
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
                          {p.moved_to && (
                            <span
                              className="ml-1 text-xs text-slate-400"
                              title={`O saldo não carregado foi para o lote ${p.moved_to}`}
                            >
                              → {p.moved_to}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 whitespace-nowrap text-slate-600">
                            {p.etd_initial ? (
                              formatDateNumeric(p.etd_initial)
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                            <button
                              type="button"
                              onClick={() => setEtdTarget(p)}
                              className="text-primary hover:opacity-70"
                              aria-label={`Open ETD for ${p.factory} × ${p.category}`}
                            >
                              <SquareArrowOutUpRight className="size-3.5" />
                            </button>
                          </div>
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

      {/* Mesmo modal de ETD da tela ETD Factories: campos completos da entrada
          + histórico de alterações, sem duplicar tela. Fica FORA do Dialog do
          View parts — Radix não empilha bem dois contents no mesmo root. */}
      <EtdOrderModal
        orderId={etdTarget?.order_id ?? null}
        ofcId={etdTarget?.id ?? null}
        title={etdTarget ? `${poBatch} — ${etdTarget.factory} × ${etdTarget.category}` : ""}
        factories={factories}
        open={!!etdTarget}
        onOpenChange={(o) => !o && setEtdTarget(null)}
      />
    </>
  );
}
