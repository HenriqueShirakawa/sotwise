"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import {
  Check,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { formatDateNumeric } from "@/lib/format";
import { BATCH_STATUS_LABELS, STATUS_COLORS } from "@/lib/status-colors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { factoriesForCategory } from "@/lib/factory-category";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  bulkImportOrderFactoryCategory,
  createBatch,
  createOrderFactoryCategory,
  deleteBatch,
  deleteOrderFactoryCategory,
  updateOrderFactoryCategoryBatch,
} from "./actions";
import { EDITABLE_BATCH_STATUSES, type BatchRow, type OfcRow, type Ref } from "./order-detail-client";

const LOADING_STATUS_LABELS: Record<string, string> = {
  total: "Total",
  partial: "Partial",
  none: "None",
};

const LOADING_STATUS_STYLES: Record<string, string> = {
  total: "border-emerald-200 bg-emerald-50 text-emerald-700",
  partial: "border-amber-200 bg-amber-50 text-amber-700",
  none: "border-slate-200 bg-slate-50 text-slate-500",
};

const PAGE_SIZE = 8;

/** Popover de seleção do lote — escolher um existente (checkbox) ou criar novo ali mesmo. */
function BatchPickerPopover({
  batches,
  value,
  onChange,
  orderId,
  onBatchesChanged,
  disabled,
}: {
  batches: BatchRow[];
  value: string | null;
  onChange: (batchId: string) => void;
  orderId: string;
  onBatchesChanged: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const selected = batches.find((b) => b.id === value);
  const nextBatchNumber = `.${String(batches.length + 1).padStart(2, "0")}`;
  // Uma vez em Pre-Loading pra frente o lote não aceita mais entradas novas —
  // mas se a entrada já estiver nele (edição existente), mantém visível.
  const selectableBatches = batches.filter(
    (b) => EDITABLE_BATCH_STATUSES.includes(b.status) || b.id === value
  );

  function addBatch() {
    startTransition(async () => {
      const res = await createBatch(orderId, { batch_number: nextBatchNumber, rows: [] });
      if (res.ok) onBatchesChanged();
      else toast.error(res.error);
    });
  }

  function removeBatch(id: string) {
    startTransition(async () => {
      const res = await deleteBatch(orderId, id);
      if (res.ok) {
        onBatchesChanged();
        if (value === id) onChange("");
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex h-10 w-full items-center gap-2 rounded-lg border border-input bg-white px-3 text-sm disabled:opacity-50"
        >
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <span className={selected ? "text-slate-800" : "text-muted-foreground"}>
            {selected?.batch_number ?? "Select batch"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="max-h-60 overflow-y-auto p-1">
          {batches.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">No batches yet.</p>
          ) : selectableBatches.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">
              No batches eligible for new entries — create one below.
            </p>
          ) : (
            selectableBatches.map((b) => {
              const label = BATCH_STATUS_LABELS[b.status];
              const hex = STATUS_COLORS[label] ?? "#475569";
              return (
                <div
                  key={b.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50"
                >
                  <Checkbox
                    checked={b.id === value}
                    disabled={pending}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        onChange(b.id);
                        setOpen(false);
                      }
                    }}
                  />
                  <span className="flex-1 text-sm text-slate-700">{b.batch_number}</span>
                  <span
                    style={{ borderColor: `${hex}59`, color: hex }}
                    className="rounded-[4px] border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap"
                  >
                    {label}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-rose-500 hover:text-rose-600"
                    aria-label="Delete batch"
                    disabled={pending}
                    onClick={() => removeBatch(b.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              );
            })
          )}
        </div>
        <div className="border-t p-1">
          <Button
            type="button"
            className="w-full"
            size="sm"
            disabled={pending}
            onClick={addBatch}
          >
            <Plus className="size-3.5" />
            Add batch
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CategoryFactorySelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Ref[];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((o) => o.id === value);
  const filtered = options
    .filter((o) => o.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 50);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-10 w-full items-center gap-2 rounded-lg border border-input bg-white px-3 text-sm"
        >
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <span className={selected ? "text-slate-800" : "text-muted-foreground"}>
            {selected?.name ?? placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="border-b p-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            className="h-9"
          />
        </div>
        <div className="max-h-60 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">No results.</p>
          ) : (
            filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-100"
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                  setQuery("");
                }}
              >
                {o.name}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

function findColumn(header: string[], needle: string): number {
  return header.findIndex((h) => h.trim().toLowerCase().includes(needle));
}

function normalizeDate(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

type ParsedRow = {
  key: string;
  categoryRaw: string;
  factoryRaw: string;
  batchNumberRaw: string;
  shipRequirementRaw: string;
  categoryId: string | null;
  factoryId: string | null;
  shipRequirement: string | null;
};

function downloadTemplate() {
  const csv = [
    "Category,Factory,Batch No.,Ship requirement",
    "Transmission,Dajin,.01,2026-08-15",
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "factory-x-category-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function BulkImportPanel({
  orderId,
  batches,
  categories,
  factories,
  onImported,
  onBatchesChanged,
  onBack,
}: {
  orderId: string;
  batches: BatchRow[];
  categories: Ref[];
  factories: Ref[];
  onImported: () => void;
  onBatchesChanged: () => void;
  onBack: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [parsing, setParsing] = useState(false);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    setParsing(true);
    file
      .text()
      .then((text) => {
        const table = parseCsv(text);
        if (table.length < 2) {
          toast.error("CSV has no data rows.");
          return;
        }
        const header = table[0];
        const categoryIdx = findColumn(header, "categor");
        const factoryIdx = findColumn(header, "factory");
        const batchIdx = findColumn(header, "batch");
        const shipIdx = findColumn(header, "ship");
        if (categoryIdx === -1 || factoryIdx === -1) {
          toast.error("CSV must have Category and Factory columns.");
          return;
        }
        const parsed: ParsedRow[] = table.slice(1).map((cols, i) => {
          const categoryRaw = (cols[categoryIdx] ?? "").trim();
          const factoryRaw = (cols[factoryIdx] ?? "").trim();
          const batchNumberRaw = batchIdx === -1 ? "" : (cols[batchIdx] ?? "").trim();
          const shipRaw = shipIdx === -1 ? "" : (cols[shipIdx] ?? "").trim();
          const category = categories.find(
            (c) => c.name.toLowerCase() === categoryRaw.toLowerCase()
          );
          const factory = factories.find(
            (f) => f.name.toLowerCase() === factoryRaw.toLowerCase()
          );
          return {
            key: `${i}-${categoryRaw}-${factoryRaw}-${batchNumberRaw}`,
            categoryRaw,
            factoryRaw,
            batchNumberRaw,
            shipRequirementRaw: shipRaw,
            categoryId: category?.id ?? null,
            factoryId: factory?.id ?? null,
            shipRequirement: normalizeDate(shipRaw),
          };
        });
        setParsedRows(parsed);
      })
      .catch(() => toast.error("Could not read the file."))
      .finally(() => setParsing(false));
  }

  const allRegistered = parsedRows.length > 0 && parsedRows.every((r) => r.categoryId && r.factoryId);
  const allComplete = parsedRows.every((r) => r.batchNumberRaw && r.shipRequirement);
  const canInsert = allRegistered && allComplete;

  function setRowBatch(key: string, batchId: string) {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return;
    setParsedRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, batchNumberRaw: batch.batch_number } : r))
    );
  }

  function submit() {
    if (!canInsert) return;
    startTransition(async () => {
      const res = await bulkImportOrderFactoryCategory(
        orderId,
        parsedRows.map((r) => ({
          category_id: r.categoryId!,
          factory_id: r.factoryId!,
          batch_number: r.batchNumberRaw,
          ship_requirement: r.shipRequirement!,
        }))
      );
      if (res.ok) {
        toast.success(
          `${parsedRows.length} ${parsedRows.length === 1 ? "entry" : "entries"} imported.`
        );
        setParsedRows([]);
        onImported();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
        <p className="text-sm text-muted-foreground">Bulk import from CSV</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
            Download template
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onBack}>
            Manual entry
          </Button>
        </div>
      </div>

      <div
        className="flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-8 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
      >
        <button
          type="button"
          className="flex flex-col items-center gap-2"
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-6 text-muted-foreground" />
          <span className="text-sm text-slate-700">
            {parsing ? "Reading file…" : "Click to upload or drag and drop"}
          </span>
          <span className="text-xs text-muted-foreground">CSV files only</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) handleFile(file);
          }}
        />
      </div>

      {parsedRows.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          <div className="grid grid-cols-[1fr_1fr_140px_1fr_auto] bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
            <span>Category</span>
            <span>Factory</span>
            <span>Batch No.</span>
            <span>Ship req.</span>
            <span />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {parsedRows.map((r) => {
              const ok = !!r.categoryId && !!r.factoryId;
              const matchedBatch = batches.find(
                (b) => b.batch_number.trim().toLowerCase() === r.batchNumberRaw.trim().toLowerCase()
              );
              return (
                <div
                  key={r.key}
                  className="grid grid-cols-[1fr_1fr_140px_1fr_auto] items-center gap-2 border-t px-3 py-2 text-sm"
                >
                  <span className={ok ? "truncate text-slate-700" : "truncate text-rose-600"}>
                    {r.categoryRaw || "—"}
                  </span>
                  <span className={ok ? "truncate text-slate-700" : "truncate text-rose-600"}>
                    {r.factoryRaw || "—"}
                  </span>
                  <BatchPickerPopover
                    batches={batches}
                    value={matchedBatch?.id ?? null}
                    onChange={(id) => setRowBatch(r.key, id)}
                    orderId={orderId}
                    onBatchesChanged={onBatchesChanged}
                  />
                  <span className="truncate text-slate-700">
                    {r.shipRequirement ? formatDateNumeric(r.shipRequirement) : "—"}
                  </span>
                  <span
                    className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full ${
                      ok ? "bg-emerald-500" : "bg-rose-500"
                    }`}
                  >
                    {ok ? (
                      <Check className="size-3 text-white" />
                    ) : (
                      <X className="size-3 text-white" />
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          {!canInsert && (
            <p className="border-t bg-rose-50 px-3 py-2 text-xs text-rose-600">
              {!allRegistered
                ? "Some rows have a Category or Factory that isn't registered — fix the CSV and re-upload, or register them first."
                : "Fill in Batch No. and a valid Ship requirement for every row."}
            </p>
          )}
        </div>
      )}

      <Button
        type="button"
        className="w-full"
        disabled={!canInsert || pending}
        onClick={submit}
      >
        <Plus className="size-3.5" />
        Insert ({parsedRows.length})
      </Button>
    </div>
  );
}

export function FactoryCategoryModal({
  open,
  onOpenChange,
  orderId,
  batches,
  ofc,
  categories,
  factories,
  factoriesByCategory,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  batches: BatchRow[];
  ofc: OfcRow[];
  categories: Ref[];
  factories: Ref[];
  factoriesByCategory: Record<string, string[]>;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"entry" | "bulk">("entry");
  const [page, setPage] = useState(0);
  const [categoryId, setCategoryId] = useState("");
  const [factoryId, setFactoryId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [shipRequirement, setShipRequirement] = useState("");

  const [syncedOpen, setSyncedOpen] = useState(false);
  if (open !== syncedOpen) {
    setSyncedOpen(open);
    if (open) {
      setMode("entry");
      setPage(0);
      setCategoryId("");
      setFactoryId("");
      setBatchId("");
      setShipRequirement("");
    }
  }

  const visibleFactories = factoriesForCategory(factories, categoryId, factoriesByCategory);
  const canInsertRow = !!categoryId && !!factoryId && !!batchId && !!shipRequirement;

  /** Trocar de categoria descarta a fábrica que não pertence à nova. */
  function selectCategory(id: string) {
    setCategoryId(id);
    const allowed = factoriesForCategory(factories, id, factoriesByCategory);
    if (factoryId && !allowed.some((f) => f.id === factoryId)) setFactoryId("");
  }

  function insertRow() {
    if (!canInsertRow) {
      toast.error("Fill in Category, Factory, Batch No. and Ship requirement.");
      return;
    }
    startTransition(async () => {
      const res = await createOrderFactoryCategory(orderId, {
        batch_id: batchId,
        category_id: categoryId,
        factory_id: factoryId,
        ship_requirement: shipRequirement,
      });
      if (res.ok) {
        setCategoryId("");
        setFactoryId("");
        setBatchId("");
        setShipRequirement("");
        onChanged();
      } else {
        toast.error(res.error);
      }
    });
  }

  function removeRow(r: OfcRow) {
    if (!r.batch_id) return;
    startTransition(async () => {
      const res = await deleteOrderFactoryCategory(orderId, r.batch_id!, r.id);
      if (res.ok) onChanged();
      else toast.error(res.error);
    });
  }

  function reassignBatch(r: OfcRow, newBatchId: string) {
    startTransition(async () => {
      const res = await updateOrderFactoryCategoryBatch(orderId, r.id, newBatchId);
      if (res.ok) onChanged();
      else toast.error(res.error);
    });
  }

  const batchNumberById = useMemo(
    () => new Map(batches.map((b) => [b.id, b.batch_number])),
    [batches]
  );

  // Ordem fixa: Category → Factory → Batch No. (a listagem crua por ordem de
  // criação ficava impossível de navegar em pedidos com muitas entradas).
  const sortedOfc = useMemo(
    () =>
      [...ofc].sort((a, b) => {
        const catCmp = a.category_name.localeCompare(b.category_name);
        if (catCmp !== 0) return catCmp;
        const facCmp = a.factory_name.localeCompare(b.factory_name);
        if (facCmp !== 0) return facCmp;
        const aBatch = batchNumberById.get(a.batch_id ?? "") ?? "";
        const bBatch = batchNumberById.get(b.batch_id ?? "") ?? "";
        return aBatch.localeCompare(bBatch, undefined, { numeric: true });
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

        {mode === "bulk" ? (
          <BulkImportPanel
            orderId={orderId}
            batches={batches}
            categories={categories}
            factories={factories}
            onImported={() => {
              onChanged();
              setMode("entry");
            }}
            onBatchesChanged={onChanged}
            onBack={() => setMode("entry")}
          />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-sm text-muted-foreground">New entry</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setMode("bulk")}>
                <Upload className="size-3.5" />
                Bulk import
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-foreground">Category</Label>
                <div className="mt-1.5">
                  <CategoryFactorySelect
                    value={categoryId}
                    onChange={selectCategory}
                    options={categories}
                    placeholder="Select category"
                  />
                </div>
              </div>
              <div>
                <Label className="text-foreground">Factory</Label>
                <div className="mt-1.5">
                  <CategoryFactorySelect
                    value={factoryId}
                    onChange={setFactoryId}
                    options={visibleFactories}
                    placeholder="Select factory"
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-foreground">Batch No.</Label>
                <div className="mt-1.5">
                  <BatchPickerPopover
                    batches={batches}
                    value={batchId || null}
                    onChange={setBatchId}
                    orderId={orderId}
                    onBatchesChanged={onChanged}
                  />
                </div>
              </div>
              <div>
                <Label className="text-foreground">Ship requirement</Label>
                <Input
                  type="date"
                  value={shipRequirement}
                  onChange={(e) => setShipRequirement(e.target.value)}
                  // h-10 casa com o BatchPickerPopover ao lado (o Input padrão
                  // do design system é h-8 e ficava mais baixo).
                  className="mt-1.5 h-10"
                />
              </div>
            </div>

            <Button
              type="button"
              className="w-full"
              disabled={!canInsertRow || pending}
              onClick={insertRow}
            >
              <Plus className="size-3.5" />
              Insert
            </Button>

            <div className="overflow-hidden rounded-lg border">
              <div className="grid grid-cols-[1fr_1fr_1fr_1fr_100px_40px] items-center bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
                <span>Category</span>
                <span>Factory</span>
                <span>Ship req.</span>
                <span>Batch No.</span>
                <span>Status</span>
                <span />
              </div>
              {pageRows.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">No entries yet.</p>
              ) : (
                pageRows.map((r) => (
                  <div
                    key={r.id}
                    className="grid grid-cols-[1fr_1fr_1fr_1fr_100px_40px] items-center gap-2 border-t px-3 py-2 text-sm"
                  >
                    <span className="truncate text-slate-700">{r.category_name}</span>
                    <span className="truncate text-slate-700">{r.factory_name}</span>
                    <span className="text-slate-700">{formatDateNumeric(r.ship_requirement)}</span>
                    <div className="w-32">
                      <BatchPickerPopover
                        batches={batches}
                        value={r.batch_id}
                        onChange={(id) => reassignBatch(r, id)}
                        orderId={orderId}
                        onBatchesChanged={onChanged}
                        disabled={pending}
                      />
                    </div>
                    <div>
                      {r.loading_status ? (
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${LOADING_STATUS_STYLES[r.loading_status]}`}
                        >
                          {LOADING_STATUS_LABELS[r.loading_status]}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="justify-self-end text-rose-500 hover:text-rose-600"
                      aria-label="Delete entry"
                      disabled={pending}
                      onClick={() => removeRow(r)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
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
        )}

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
