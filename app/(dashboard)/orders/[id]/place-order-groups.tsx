"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { formatDateNumeric, todayIso } from "@/lib/format";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/date-picker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { saveFactoryPlacedDate } from "./actions";
import type { BatchRow, OfcRow } from "./order-detail-client";

const GROUPS_PAGE_SIZE = 10;

type FactoryGroup = {
  factory_id: string;
  factory_name: string;
  entries: { id: string; category_name: string; batch_number: string }[];
};

/** Agrupa as entradas Factory x Category do pedido por Factory — mesma
 * entidade da etapa PO, só reexibida agrupada (ver docs/regras_de_negocio.md
 * §3.7.3). */
function buildFactoryGroups(ofc: OfcRow[], batches: BatchRow[]): FactoryGroup[] {
  const batchNumberById = new Map(batches.map((b) => [b.id, b.batch_number]));
  const byFactory = new Map<string, FactoryGroup>();
  for (const r of ofc) {
    if (!byFactory.has(r.factory_id)) {
      byFactory.set(r.factory_id, {
        factory_id: r.factory_id,
        factory_name: r.factory_name,
        entries: [],
      });
    }
    byFactory.get(r.factory_id)!.entries.push({
      id: r.id,
      category_name: r.category_name,
      batch_number: r.batch_id ? (batchNumberById.get(r.batch_id) ?? "—") : "—",
    });
  }
  return Array.from(byFactory.values()).sort((a, b) =>
    a.factory_name.localeCompare(b.factory_name)
  );
}

/**
 * Popup da data "Placed on" de uma fábrica (22/10/2026): a 1ª gravação é livre,
 * trocar depois exige motivo — de → para e motivo vão pro History da etapa.
 */
function PlacedOnDialog({
  orderId,
  factory,
  current,
  onClose,
}: {
  orderId: string;
  factory: { id: string; name: string };
  current: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(current ?? "");
  const [reason, setReason] = useState("");
  const reasonRequired = !!current;
  const canSave = !!date && date !== current && (!reasonRequired || reason.trim() !== "");

  function save() {
    startTransition(async () => {
      const res = await saveFactoryPlacedDate(orderId, factory.id, date, reason.trim() || null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(current ? "Revision saved." : "Placed-on date saved.");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg text-primary">Placed on — {factory.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-foreground">Placed on</Label>
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
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="button" className="flex-1" disabled={!canSave || pending} onClick={save}>
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PlaceOrderFactoryGroups({
  orderId,
  ofc,
  batches,
  placedDates,
}: {
  orderId: string;
  ofc: OfcRow[];
  batches: BatchRow[];
  /** factory_id → data "Placed on" (YYYY-MM-DD). */
  placedDates: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [dateFor, setDateFor] = useState<{ id: string; name: string } | null>(null);

  const groups = buildFactoryGroups(ofc, batches);
  const totalPages = Math.max(1, Math.ceil(groups.length / GROUPS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageGroups = groups.slice(
    safePage * GROUPS_PAGE_SIZE,
    safePage * GROUPS_PAGE_SIZE + GROUPS_PAGE_SIZE
  );

  function toggle(factoryId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(factoryId)) next.delete(factoryId);
      else next.add(factoryId);
      return next;
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      {dateFor && (
        <PlacedOnDialog
          orderId={orderId}
          factory={dateFor}
          current={placedDates[dateFor.id] ?? null}
          onClose={() => setDateFor(null)}
        />
      )}
      <div className="hidden grid-cols-[1fr_120px_170px_40px] items-center gap-2 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500 sm:grid">
        <span>Factory</span>
        <span>N° of categories</span>
        <span>Placed on</span>
        <span />
      </div>
      {pageGroups.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">
          No Factory x Category entries for this order yet.
        </p>
      ) : (
        pageGroups.map((g) => {
          const open = expanded.has(g.factory_id);
          const categoryCount = new Set(g.entries.map((e) => e.category_name)).size;
          // Data da fábrica = a "Placed on" informada pelo usuário (22/10/2026;
          // antes era a do 1º documento). Sem documento nenhum desde 29/10/2026.
          const placedOn = placedDates[g.factory_id] ?? null;
          return (
            <div key={g.factory_id} className="border-t">
              <div className="grid grid-cols-[1fr_auto] items-center gap-2 px-3 py-2.5 text-sm sm:grid-cols-[1fr_120px_170px_40px]">
                <span className="flex min-w-0 items-center gap-2">
                  {/* Verde = fábrica já tem a data; âmbar = ainda falta. A
                      etapa só conclui quando todas estão verdes. */}
                  <span
                    aria-hidden
                    title={placedOn ? "Placed-on date set" : "Needs the placed-on date"}
                    className={`size-2 shrink-0 rounded-full ${
                      placedOn ? "bg-emerald-500" : "bg-amber-500"
                    }`}
                  />
                  <span className="truncate font-medium text-slate-800">{g.factory_name}</span>
                </span>
                <span className="text-slate-700 max-sm:col-start-1 max-sm:text-xs max-sm:text-slate-500">
                  {/* Categorias DISTINTAS da fábrica — a mesma categoria em
                      vários lotes conta uma vez (as linhas ficam na lista abaixo). */}
                  {categoryCount}
                  <span className="sm:hidden">
                    {categoryCount === 1 ? " category" : " categories"}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-slate-700 max-sm:col-start-1 max-sm:text-xs">
                  <span className="sm:hidden text-slate-500">Placed on </span>
                  <span>{placedOn ? formatDateNumeric(placedOn) : "—"}</span>
                  <button
                    type="button"
                    className="text-xs font-medium text-primary hover:underline"
                    onClick={() => setDateFor({ id: g.factory_id, name: g.factory_name })}
                  >
                    {placedOn ? "Revise" : "Set date"}
                  </button>
                </span>
                <button
                  type="button"
                  aria-label={open ? "Collapse" : "Expand"}
                  className="justify-self-center max-sm:col-start-2 max-sm:row-start-1"
                  onClick={() => toggle(g.factory_id)}
                >
                  <ChevronDown
                    className={`size-4 text-slate-400 transition-transform ${
                      open ? "rotate-180" : ""
                    }`}
                  />
                </button>
              </div>
              {open && (
                <div className="border-t bg-slate-50/60">
                  <div className="grid grid-cols-2 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500">
                    <span>Categories</span>
                    <span>Batch Number</span>
                  </div>
                  {g.entries.map((e) => (
                    <div key={e.id} className="grid grid-cols-2 border-t px-3 py-2 text-sm">
                      <span className="truncate text-slate-700">{e.category_name}</span>
                      <span className="text-slate-700">{e.batch_number}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
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
    </div>
  );
}
