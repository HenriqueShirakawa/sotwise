"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpDown, ArrowUpRight, Eye } from "lucide-react";
import { toast } from "sonner";

import { formatDateNumeric, formatDateTime } from "@/lib/format";
import { SearchSelect } from "@/components/search-select";
import { DatePicker } from "@/components/date-picker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { getEtdHistory, updateEtdInfoWithReason, upsertEtdInfo } from "./actions";
import type { EtdHistoryEntry } from "./actions";
import type { BatchRow, EtdInfoRow, OfcRow, Ref } from "./order-detail-client";

const EMPTY_ETD: EtdInfoRow = {
  inspection: false,
  ready: false,
  ready_date: null,
  initial_date: null,
  current_date: null,
  dispatch_location_id: null,
  dispatch_date: null,
  remarks: null,
};

const EDITABLE_FIELDS = [
  { value: "current_date", label: "Current Date" },
  { value: "ready", label: "Ready" },
  { value: "inspection", label: "Inspection" },
  { value: "dispatch_location_id", label: "Dispatch Location" },
  { value: "dispatch_date", label: "Dispatch Date" },
] as const;

type FieldKey = (typeof EDITABLE_FIELDS)[number]["value"];

/**
 * Rótulos de todo campo que pode aparecer no histórico. Vai além de
 * EDITABLE_FIELDS porque `initial_date` só é editável na linha, nunca no modal.
 */
const HISTORY_FIELD_LABELS: Record<string, string> = {
  current_date: "Current Date",
  ready: "Ready",
  inspection: "Inspection",
  initial_date: "Initial Date",
  dispatch_location_id: "Dispatch Location",
  dispatch_date: "Dispatch Date",
};

const HISTORY_PAGE_SIZE = 10;
const ETD_PAGE_SIZE = 10;

type EtdSortKey =
  | "inspection"
  | "ready"
  | "factory"
  | "category"
  | "batch"
  | "initial_date"
  | "current_date"
  | "dispatch_location"
  | "dispatch_date";

function SortableTableHead({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: EtdSortKey;
  sort: { key: EtdSortKey; dir: "asc" | "desc" } | null;
  onSort: (key: EtdSortKey) => void;
}) {
  const active = sort?.key === sortKey;
  return (
    <TableHead>
      <button
        type="button"
        className="inline-flex items-center gap-1 whitespace-nowrap hover:text-slate-700"
        onClick={() => onSort(sortKey)}
      >
        {label}
        <ArrowUpDown className={`size-3.5 ${active ? "text-primary" : "text-slate-400"}`} />
      </button>
    </TableHead>
  );
}

function RemarksCell({ remarks }: { remarks: string | null }) {
  const [open, setOpen] = useState(false);
  if (!remarks) return <span className="text-slate-300">—</span>;
  return (
    <div className="flex items-center gap-1.5">
      <span className="max-w-32 truncate">{remarks}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" aria-label="Full remarks" className="text-slate-400 hover:text-slate-600">
            <Eye className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3">
          <p className="mb-1 text-sm font-medium text-foreground">Full remarks</p>
          <p className="text-sm break-words text-slate-600">{remarks}</p>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * Campo alterado + por onde a alteração passou. A edição na linha não pede
 * motivo, então a origem é o único contexto que o histórico guarda dela — sem
 * isso as duas ficam indistinguíveis na auditoria.
 */
function ChangedCell({ field, source }: { field: string; source?: "modal" | "row" }) {
  return (
    <div className="min-w-0">
      <span className="font-medium whitespace-nowrap text-slate-800">
        {HISTORY_FIELD_LABELS[field] ?? field}
      </span>
      <span className="block text-[11px] whitespace-nowrap text-slate-400">
        {source === "row" ? "in-row edit" : "ETD update"}
      </span>
    </div>
  );
}

/** Campo do histórico em formato card (só abaixo de sm). */
function HistoryField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-slate-700">{children}</dd>
    </div>
  );
}

function EtdUpdateModal({
  orderId,
  row,
  etd,
  factories,
  open,
  onOpenChange,
  onChanged,
}: {
  orderId: string;
  row: OfcRow | null;
  etd: EtdInfoRow;
  factories: Ref[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void | Promise<void>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [field, setField] = useState<FieldKey | "">("");
  const [dateValue, setDateValue] = useState("");
  const [boolValue, setBoolValue] = useState(false);
  const [locationId, setLocationId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [history, setHistory] = useState<EtdHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [page, setPage] = useState(0);

  const openFor = open ? (row?.id ?? null) : null;
  const [syncedFor, setSyncedFor] = useState<string | null>(null);
  if (openFor !== syncedFor) {
    setSyncedFor(openFor);
    setField("");
    setDateValue("");
    setBoolValue(false);
    setLocationId("");
    setRemarks("");
    setPage(0);
    setHistory([]);
    if (row) {
      setHistoryLoading(true);
      getEtdHistory(row.id).then((res) => {
        if (res.ok) setHistory(res.rows);
        else toast.error(res.error);
        setHistoryLoading(false);
      });
    }
  }

  const canSave = !!row && !!field && remarks.trim() !== "";

  function selectField(next: FieldKey) {
    setField(next);
    if (next === "ready") setBoolValue(etd.ready);
    else if (next === "inspection") setBoolValue(etd.inspection);
    else if (next === "current_date") setDateValue(etd.current_date ?? "");
    else if (next === "dispatch_date") setDateValue(etd.dispatch_date ?? "");
    else if (next === "dispatch_location_id") setLocationId(etd.dispatch_location_id ?? "");
  }

  function save() {
    if (!row || !field) return;
    const value: string | boolean | null =
      field === "ready" || field === "inspection"
        ? boolValue
        : field === "dispatch_location_id"
          ? locationId || null
          : dateValue || null;
    startTransition(async () => {
      const res = await updateEtdInfoWithReason(orderId, row.id, field, value, remarks);
      if (res.ok) {
        toast.success("ETD updated.");
        router.refresh();
        await onChanged?.();
        const historyRes = await getEtdHistory(row.id);
        if (historyRes.ok) setHistory(historyRes.rows);
        setField("");
        setDateValue("");
        setBoolValue(false);
        setLocationId("");
        setRemarks("");
      } else {
        toast.error(res.error);
      }
    });
  }

  const totalPages = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = history.slice(
    safePage * HISTORY_PAGE_SIZE,
    safePage * HISTORY_PAGE_SIZE + HISTORY_PAGE_SIZE
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle className="text-lg text-primary">ETD update</DialogTitle>
          {row && (
            <p className="text-sm text-muted-foreground">
              {row.factory_name} - {row.category_name}
            </p>
          )}
        </DialogHeader>

        <div className="min-w-0 space-y-5">
          <div className="space-y-4 rounded-lg bg-slate-50 p-4">
            <div>
              <Label className="text-foreground">Select what you want to change:</Label>
              <div className="mt-1.5">
                <Select value={field} onValueChange={(v) => selectField(v as FieldKey)}>
                  <SelectTrigger className="w-full bg-white">
                    <SelectValue placeholder="Select a field" />
                  </SelectTrigger>
                  <SelectContent>
                    {EDITABLE_FIELDS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {field === "current_date" || field === "dispatch_date" ? (
              <div>
                <Label className="text-foreground">
                  {field === "current_date" ? "Current date" : "Dispatch date"}
                </Label>
                <DatePicker
                  value={dateValue}
                  onChange={(v) => setDateValue(v ?? "")}
                  className="mt-1.5 bg-white"
                />
              </div>
            ) : field === "ready" || field === "inspection" ? (
              <div>
                <label className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm">
                  <Checkbox
                    checked={boolValue}
                    onCheckedChange={(checked) => setBoolValue(!!checked)}
                  />
                  {field === "ready" ? "Ready" : "Inspection"}
                </label>
              </div>
            ) : field === "dispatch_location_id" ? (
              <div>
                <Label className="text-foreground">Dispatch Location</Label>
                <div className="mt-1.5">
                  <SearchSelect
                    value={locationId}
                    onChange={setLocationId}
                    options={factories}
                    placeholder="Select factory"
                  />
                </div>
              </div>
            ) : null}

            {field && (
              <div>
                <Label className="text-foreground">Remarks</Label>
                <Textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Add a brief description…"
                  className="mt-1.5 bg-white"
                  rows={3}
                />
              </div>
            )}

            <Button className="w-full" disabled={!canSave || pending} onClick={save}>
              Save changes
            </Button>
          </div>

          <div className="overflow-hidden rounded-lg border">
            {/* Abaixo de sm o histórico vira cards — 9 colunas não cabem no modal. */}
            <div className="divide-y sm:hidden">
              {historyLoading ? (
                <p className="px-3 py-4 text-center text-sm text-muted-foreground">Loading…</p>
              ) : pageRows.length === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                  No changes logged yet.
                </p>
              ) : (
                pageRows.map((h) => (
                  <div key={h.id} className="px-3 py-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-slate-800">
                        {row?.factory_name} · {row?.category_name}
                      </span>
                      <span className="shrink-0 text-xs text-slate-500">
                        {formatDateTime(h.changed_at)}
                      </span>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                      <HistoryField label="Changed">
                        <ChangedCell field={h.field} source={h.source} />
                      </HistoryField>
                      <HistoryField label="Insp.">
                        <Checkbox checked={h.inspection} disabled />
                      </HistoryField>
                      <HistoryField label="Ready?">
                        <Checkbox checked={h.ready} disabled />
                      </HistoryField>
                      <HistoryField label="Current date">
                        {formatDateNumeric(h.current_date)}
                      </HistoryField>
                      <HistoryField label="Dispatch lo.">
                        {h.dispatch_location_name ?? "—"}
                      </HistoryField>
                      <HistoryField label="Dispatch da.">
                        {formatDateNumeric(h.dispatch_date)}
                      </HistoryField>
                      <HistoryField label="Remarks">
                        <RemarksCell remarks={h.remarks} />
                      </HistoryField>
                    </dl>
                  </div>
                ))
              )}
            </div>

            <Table className="hidden sm:table">
              <TableHeader>
                <TableRow>
                  <TableHead>Changed</TableHead>
                  <TableHead>Insp.</TableHead>
                  <TableHead>Ready?</TableHead>
                  <TableHead>Remarks</TableHead>
                  <TableHead>Factory</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Current date</TableHead>
                  <TableHead>Dispatch lo.</TableHead>
                  <TableHead>Dispatch da.</TableHead>
                  <TableHead>Date/Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyLoading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : pageRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground">
                      No changes logged yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  pageRows.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell>
                        <ChangedCell field={h.field} source={h.source} />
                      </TableCell>
                      <TableCell>
                        <Checkbox checked={h.inspection} disabled />
                      </TableCell>
                      <TableCell>
                        <Checkbox checked={h.ready} disabled />
                      </TableCell>
                      <TableCell>
                        <RemarksCell remarks={h.remarks} />
                      </TableCell>
                      <TableCell>{row?.factory_name}</TableCell>
                      <TableCell>{row?.category_name}</TableCell>
                      <TableCell>{formatDateNumeric(h.current_date)}</TableCell>
                      <TableCell>{h.dispatch_location_name ?? "—"}</TableCell>
                      <TableCell>{formatDateNumeric(h.dispatch_date)}</TableCell>
                      <TableCell className="text-slate-500">
                        {formatDateTime(h.changed_at)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
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
        </div>

        <DialogFooter>
          <Button variant="outline" className="sm:min-w-32" onClick={() => onOpenChange(false)}>
            Back
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EtdStepTable({
  orderId,
  ofc,
  batches,
  etdByOfc,
  factories,
  onChanged,
}: {
  orderId: string;
  ofc: OfcRow[];
  batches: BatchRow[];
  etdByOfc: Record<string, EtdInfoRow>;
  factories: Ref[];
  onChanged?: () => void | Promise<void>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [modalRow, setModalRow] = useState<OfcRow | null>(null);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ key: EtdSortKey; dir: "asc" | "desc" } | null>(null);

  // UI otimista dos checkboxes Ready/Inspection: marca na hora e mantém durante
  // o server action + refresh; reconcilia com o dado do servidor quando chega e
  // reverte sozinho se a ação falhar.
  const [optimisticEtd, addOptimistic] = useOptimistic(
    etdByOfc,
    (
      state: Record<string, EtdInfoRow>,
      action: { ofcId: string; inspection?: boolean; ready?: boolean }
    ) => {
      const cur = state[action.ofcId] ?? EMPTY_ETD;
      return {
        ...state,
        [action.ofcId]: {
          ...cur,
          ...(action.inspection !== undefined ? { inspection: action.inspection } : {}),
          ...(action.ready !== undefined ? { ready: action.ready } : {}),
        },
      };
    }
  );

  const batchNumberById = new Map(batches.map((b) => [b.id, b.batch_number]));
  const factoryNameById = new Map(factories.map((f) => [f.id, f.name]));

  function sortValue(r: OfcRow, key: EtdSortKey): string | number {
    const etd = etdByOfc[r.id] ?? EMPTY_ETD;
    switch (key) {
      case "inspection":
        return etd.inspection ? 1 : 0;
      case "ready":
        return etd.ready ? 1 : 0;
      case "factory":
        return r.factory_name;
      case "category":
        return r.category_name;
      case "batch":
        return batchNumberById.get(r.batch_id ?? "") ?? "";
      case "initial_date":
        return etd.initial_date ?? "";
      case "current_date":
        return etd.current_date ?? "";
      case "dispatch_location":
        return factoryNameById.get(etd.dispatch_location_id ?? "") ?? "";
      case "dispatch_date":
        return etd.dispatch_date ?? "";
    }
  }

  function toggleSort(key: EtdSortKey) {
    setPage(0);
    setSort((prev) => {
      if (prev?.key === key) return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      return { key, dir: "asc" };
    });
  }

  const rows = [...ofc].sort((a, b) => {
    if (!sort) {
      return (
        a.factory_name.localeCompare(b.factory_name) ||
        a.category_name.localeCompare(b.category_name) ||
        (batchNumberById.get(a.batch_id ?? "") ?? "").localeCompare(
          batchNumberById.get(b.batch_id ?? "") ?? "",
          undefined,
          { numeric: true }
        )
      );
    }
    const dir = sort.dir === "asc" ? 1 : -1;
    const av = sortValue(a, sort.key);
    const bv = sortValue(b, sort.key);
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
  });

  const totalPages = Math.max(1, Math.ceil(rows.length / ETD_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = rows.slice(safePage * ETD_PAGE_SIZE, safePage * ETD_PAGE_SIZE + ETD_PAGE_SIZE);

  function save(ofcId: string, patch: Parameters<typeof upsertEtdInfo>[2]) {
    startTransition(async () => {
      if (patch.inspection !== undefined || patch.ready !== undefined) {
        addOptimistic({ ofcId, inspection: patch.inspection, ready: patch.ready });
      }
      const res = await upsertEtdInfo(orderId, ofcId, patch);
      if (res.ok) {
        router.refresh();
        await onChanged?.();
      } else {
        toast.error(res.error);
      }
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border bg-white px-3 py-4 text-sm text-muted-foreground">
        No Factory x Category entries for this order yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableTableHead label="Insp." sortKey="inspection" sort={sort} onSort={toggleSort} />
            <SortableTableHead label="Ready?" sortKey="ready" sort={sort} onSort={toggleSort} />
            <SortableTableHead label="Factory" sortKey="factory" sort={sort} onSort={toggleSort} />
            <SortableTableHead label="Category" sortKey="category" sort={sort} onSort={toggleSort} />
            <SortableTableHead label="Batch" sortKey="batch" sort={sort} onSort={toggleSort} />
            <SortableTableHead
              label="Initial Date"
              sortKey="initial_date"
              sort={sort}
              onSort={toggleSort}
            />
            <SortableTableHead
              label="Current Date"
              sortKey="current_date"
              sort={sort}
              onSort={toggleSort}
            />
            <SortableTableHead
              label="Dispatch loc."
              sortKey="dispatch_location"
              sort={sort}
              onSort={toggleSort}
            />
            <SortableTableHead
              label="Dispatch date"
              sortKey="dispatch_date"
              sort={sort}
              onSort={toggleSort}
            />
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageRows.map((r) => {
            const etd = optimisticEtd[r.id] ?? EMPTY_ETD;
            return (
              <TableRow key={r.id}>
                <TableCell>
                  <Checkbox
                    checked={etd.inspection}
                    disabled={etd.inspection}
                    onCheckedChange={(checked) => save(r.id, { inspection: !!checked })}
                  />
                </TableCell>
                <TableCell>
                  <Checkbox
                    checked={etd.ready}
                    disabled={etd.ready}
                    onCheckedChange={(checked) => save(r.id, { ready: !!checked })}
                  />
                </TableCell>
                <TableCell className="font-medium text-slate-800">{r.factory_name}</TableCell>
                <TableCell>{r.category_name}</TableCell>
                <TableCell>{r.batch_id ? (batchNumberById.get(r.batch_id) ?? "—") : "—"}</TableCell>
                <TableCell>
                  <DatePicker
                    value={etd.initial_date}
                    className="w-36"
                    onChange={(v) => {
                      if (v !== (etd.initial_date ?? null)) save(r.id, { initial_date: v });
                    }}
                  />
                </TableCell>
                <TableCell className="text-slate-500">
                  {formatDateNumeric(etd.current_date)}
                </TableCell>
                <TableCell className="w-40">
                  <SearchSelect
                    value={etd.dispatch_location_id ?? ""}
                    onChange={(v) => save(r.id, { dispatch_location_id: v || null })}
                    options={factories}
                    placeholder="Select"
                  />
                </TableCell>
                <TableCell>
                  <DatePicker
                    value={etd.dispatch_date}
                    className="w-36"
                    onChange={(v) => {
                      if (v !== (etd.dispatch_date ?? null)) save(r.id, { dispatch_date: v });
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-primary"
                    aria-label="ETD update"
                    onClick={() => setModalRow(r)}
                  >
                    <ArrowUpRight className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
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

      <EtdUpdateModal
        orderId={orderId}
        row={modalRow}
        etd={modalRow ? (etdByOfc[modalRow.id] ?? EMPTY_ETD) : EMPTY_ETD}
        factories={factories}
        open={!!modalRow}
        onOpenChange={(o) => !o && setModalRow(null)}
        onChanged={onChanged}
      />
    </div>
  );
}
