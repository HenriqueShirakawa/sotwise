"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  Info,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { formatDateNumeric } from "@/lib/format";
import { filterSteps, type ViewPrefs } from "@/lib/view-prefs";
import {
  hasExtraRequirements,
  isStepChecked,
  missingLabel,
  piDocumentRequired,
  type ChecklistFacts,
} from "@/lib/checklist-completion";
import { BATCH_STATUS_LABELS, ORDER_STATUS_LABELS, STATUS_COLORS } from "@/lib/status-colors";
import type { BatchStatus, ChecklistStep, LoadingStatus, OrderStatus } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { StatusPill } from "@/components/status-pill";
import { SearchSelect } from "@/components/search-select";
import { AttachedDocuments } from "@/components/attached-documents";
import { DatePicker } from "@/components/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  createBatch,
  createOrderFactoryCategory,
  deleteOrderFactoryCategory,
  deleteStepAttachment,
  getAttachmentDownloadUrl,
  updateBatchNumber,
  updateBatchStatus,
  updateChecklistStep,
  uploadStepAttachment,
} from "./actions";
import { factoriesForCategory } from "@/lib/factory-category";
import { FactoryCategoryModal } from "./factory-category-modal";
import { PlaceOrderFactoryGroups } from "./place-order-groups";
import { EtdStepTable } from "./etd-step";

const STEP_LABELS: Record<ChecklistStep, string> = {
  order: "Order",
  po: "PO",
  pi: "PI",
  deposit_payment: "Deposit Payment",
  packing_confirm: "Packing Confirm.",
  condition_confirm: "Condition Confirm.",
  place_the_order: "Place the Order",
  etd: "ETD",
  balance_payment: "Balance Payment",
  pre_loading: "Pre-Loading",
  consolidation_point: "Consolidation point",
  city: "City",
  port_of_loading: "Port of loading",
  shipping_docs: "Shipping docs",
  agents: "Agents",
  booking: "Booking",
  loading_date: "Loading date",
  shipping_date: "Shipping date",
  bl: "BL",
  original_docs: "Original docs",
  inspection_report: "Inspection report",
  eta_brazil: "ETA Brazil",
  ata_brazil: "ATA Brazil",
  delivered: "Delivered",
};

// Só estas 4 etapas têm toggle (podem ser desativadas p/ este pedido) — as
// demais são fixas. Ver docs/regras_de_negocio.md §3.7.5.
const TOGGLEABLE_STEPS = new Set<ChecklistStep>([
  "deposit_payment",
  "packing_confirm",
  "condition_confirm",
  "balance_payment",
]);

// Só lotes em In Negotiation/In Production aceitam novas entradas Factory x
// Category (ou troca de lote de uma entrada existente) — uma vez em
// Pre-Loading pra frente, o lote "fecha" pra esse cadastro (regra do Bubble).
export const EDITABLE_BATCH_STATUSES: BatchStatus[] = ["in_negotiation", "in_production"];

export type ChecklistStepRow = {
  id: string;
  step: ChecklistStep;
  enabled: boolean;
  /** Espelho de `completed_on` no banco — a tela recalcula pela regra real. */
  done: boolean;
  estimated_date: string | null;
  completed_on: string | null;
  responsible_id: string | null;
  signed_by_id: string | null;
  attachments: {
    id: string;
    factory_id: string | null;
    file_name: string | null;
    file_path: string;
  }[];
};

export type OfcRow = {
  id: string;
  batch_id: string | null;
  category_id: string;
  category_name: string;
  factory_id: string;
  factory_name: string;
  ship_requirement: string;
  loading_status: LoadingStatus | null;
};

export type EtdInfoRow = {
  inspection: boolean;
  ready: boolean;
  ready_date: string | null;
  initial_date: string | null;
  current_date: string | null;
  dispatch_location_id: string | null;
  dispatch_date: string | null;
  remarks: string | null;
};

export type BatchRow = { id: string; batch_number: string; status: BatchStatus };
export type Ref = { id: string; name: string };

type OrderDetail = {
  po_number: string;
  bu: string | null;
  type: string | null;
  client: string | null;
  client_reference: string | null;
  requester: string | null;
  leader: string | null;
  exporter: string | null;
  date_po: string | null;
  status: OrderStatus;
  schedule_requested: string | null;
};

const dash = <span className="text-slate-300">—</span>;

function InfoField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-slate-800">{value ?? dash}</p>
    </div>
  );
}

/**
 * Célula das listinhas dentro dos modais: no mobile a linha vira card, então o
 * rótulo do cabeçalho (escondido lá) reaparece junto do valor.
 */
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

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-4">
      <p className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">{title}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Avatar({ name }: { name: string | null }) {
  const letter = name?.trim().charAt(0).toUpperCase() || "?";
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-medium text-slate-500">
      {letter}
    </span>
  );
}

function ResponsibleRow({ name, role }: { name: string | null; role: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
      <Avatar name={name} />
      <div>
        <p className="text-sm font-medium text-slate-800">{name ?? dash}</p>
        <p className="text-xs text-muted-foreground">{role}</p>
      </div>
    </div>
  );
}

/**
 * Bolinha da etapa: halo claro por fora + miolo menor no centro. Verde quando
 * a etapa está concluída pela regra de `lib/checklist-completion` (data +
 * eventuais exigências extras); "i" laranja quando a etapa exige mais que a
 * data e ainda não fechou — o tooltip diz o que falta.
 */
function StepIcon({
  enabled,
  checked,
  gated,
  title,
}: {
  enabled: boolean;
  checked: boolean;
  /** A etapa tem exigência além do "Completed on". */
  gated: boolean;
  title?: string;
}) {
  // Etapa desligada não se aplica a este pedido: fica sempre a bolinha cinza,
  // nunca verde/laranja — não reflete conclusão nem cobrança em lugar nenhum.
  const icon = !enabled ? (
    <span className="inline-flex size-5 items-center justify-center rounded-full bg-slate-100">
      <span className="size-2 rounded-full bg-slate-400" />
    </span>
  ) : checked ? (
    <CheckCircle2 className="size-5 fill-emerald-600 text-white" />
  ) : gated ? (
    <Info className="size-5 fill-amber-500 text-white" />
  ) : (
    <span className="inline-flex size-5 items-center justify-center rounded-full bg-blue-100">
      <span className="size-2 rounded-full bg-blue-600" />
    </span>
  );
  return (
    <span className="flex shrink-0" title={title} aria-label={title}>
      {icon}
    </span>
  );
}

function BatchStatusSelect({
  value,
  onChange,
}: {
  value: BatchStatus;
  onChange: (value: BatchStatus) => void;
}) {
  const label = BATCH_STATUS_LABELS[value];
  const hex = STATUS_COLORS[label] ?? "#475569";
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as BatchStatus)}
      style={{ borderColor: `${hex}59`, color: hex }}
      className="h-7 max-w-[220px] rounded-[4px] border bg-white px-1.5 text-xs font-medium"
    >
      {EDITABLE_BATCH_STATUSES.map((s) => (
        <option key={s} value={s}>
          {BATCH_STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

const ROWS_PAGE_SIZE = 10;

/** Ordena por Category, depois Factory — mesmo critério do modal Factory x Category. */
function sortByCategoryFactory(rows: OfcRow[]): OfcRow[] {
  return [...rows].sort(
    (a, b) =>
      a.category_name.localeCompare(b.category_name) ||
      a.factory_name.localeCompare(b.factory_name)
  );
}

function RowsPagination({
  page,
  setPage,
  total,
}: {
  page: number;
  setPage: (updater: (p: number) => number) => void;
  total: number;
}) {
  const totalPages = Math.max(1, Math.ceil(total / ROWS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  if (total <= ROWS_PAGE_SIZE) return null;
  return (
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
  );
}

function ViewBatchModal({
  open,
  onOpenChange,
  batch,
  rows,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batch: BatchRow | null;
  rows: OfcRow[];
}) {
  const [page, setPage] = useState(0);
  const openFor = open ? batch?.id ?? null : null;
  const [syncedFor, setSyncedFor] = useState<string | null>(null);
  if (openFor !== syncedFor) {
    setSyncedFor(openFor);
    setPage(0);
  }
  const sortedRows = sortByCategoryFactory(rows);
  const safePage = Math.min(page, Math.max(0, Math.ceil(sortedRows.length / ROWS_PAGE_SIZE) - 1));
  const pageRows = sortedRows.slice(
    safePage * ROWS_PAGE_SIZE,
    safePage * ROWS_PAGE_SIZE + ROWS_PAGE_SIZE
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg text-primary">View batch</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="mb-2 border-b pb-2 text-sm text-muted-foreground">Main information</p>
            <Label className="text-foreground">Batch No.</Label>
            <Input value={batch?.batch_number ?? ""} disabled className="mt-1.5 bg-muted" />
          </div>
          <div>
            <p className="mb-2 border-b pb-2 text-sm text-muted-foreground">Shipment request</p>
            <div className="overflow-hidden rounded-lg border">
              <div className="hidden grid-cols-4 gap-x-3 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500 sm:grid">
                <span>Category</span>
                <span>Factory</span>
                <span>Ship req.</span>
                <span>Batch No.</span>
              </div>
              {pageRows.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">No entries for this batch.</p>
              ) : (
                pageRows.map((r) => (
                  <div
                    key={r.id}
                    className="grid grid-cols-2 gap-x-3 gap-y-2 border-t px-3 py-2.5 text-sm sm:grid-cols-4 sm:gap-y-0"
                  >
                    <SmallField label="Category">
                      <span className="text-slate-700">{r.category_name}</span>
                    </SmallField>
                    <SmallField label="Factory">
                      <span className="text-slate-700">{r.factory_name}</span>
                    </SmallField>
                    <SmallField label="Ship req.">
                      <span className="text-slate-700">
                        {formatDateNumeric(r.ship_requirement)}
                      </span>
                    </SmallField>
                    <SmallField label="Batch No.">
                      <span className="text-slate-700">{batch?.batch_number}</span>
                    </SmallField>
                  </div>
                ))
              )}
              <RowsPagination page={page} setPage={setPage} total={rows.length} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="sm:min-w-32" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditBatchModal({
  open,
  onOpenChange,
  orderId,
  batch,
  rows,
  categories,
  factories,
  factoriesByCategory,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  batch: BatchRow | null;
  rows: OfcRow[];
  categories: Ref[];
  factories: Ref[];
  factoriesByCategory: Record<string, string[]>;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [batchNumber, setBatchNumber] = useState(batch?.batch_number ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [factoryId, setFactoryId] = useState("");
  const [shipRequirement, setShipRequirement] = useState("");
  const [page, setPage] = useState(0);

  const openFor = open ? batch?.id ?? null : null;
  const [syncedFor, setSyncedFor] = useState<string | null>(null);
  if (openFor !== syncedFor) {
    setSyncedFor(openFor);
    setBatchNumber(batch?.batch_number ?? "");
    setCategoryId("");
    setFactoryId("");
    setShipRequirement("");
    setPage(0);
  }

  const sortedRows = sortByCategoryFactory(rows);
  const safePage = Math.min(page, Math.max(0, Math.ceil(sortedRows.length / ROWS_PAGE_SIZE) - 1));
  const pageRows = sortedRows.slice(
    safePage * ROWS_PAGE_SIZE,
    safePage * ROWS_PAGE_SIZE + ROWS_PAGE_SIZE
  );

  const visibleFactories = factoriesForCategory(factories, categoryId, factoriesByCategory);
  const canAdd = !!categoryId && !!factoryId && !!shipRequirement;

  /** Trocar de categoria descarta a fábrica que não pertence à nova. */
  function selectCategory(id: string) {
    setCategoryId(id);
    const allowed = factoriesForCategory(factories, id, factoriesByCategory);
    if (factoryId && !allowed.some((f) => f.id === factoryId)) setFactoryId("");
  }

  function addRow() {
    if (!batch || !categoryId || !factoryId || !shipRequirement) {
      toast.error("Select a category, factory, and ship requirement date.");
      return;
    }
    startTransition(async () => {
      const res = await createOrderFactoryCategory(orderId, {
        batch_id: batch.id,
        category_id: categoryId,
        factory_id: factoryId,
        ship_requirement: shipRequirement,
      });
      if (res.ok) {
        setCategoryId("");
        setFactoryId("");
        setShipRequirement("");
        onSaved();
      } else {
        toast.error(res.error);
      }
    });
  }

  function removeRow(id: string) {
    if (!batch) return;
    startTransition(async () => {
      const res = await deleteOrderFactoryCategory(orderId, batch.id, id);
      if (res.ok) onSaved();
      else toast.error(res.error);
    });
  }

  function save() {
    if (!batch) return;
    startTransition(async () => {
      const res = await updateBatchNumber(orderId, batch.id, batchNumber);
      if (res.ok) {
        toast.success("Batch updated.");
        onSaved();
        onOpenChange(false);
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg text-primary">Edit batch</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="mb-2 border-b pb-2 text-sm text-muted-foreground">Main information</p>
            <Label className="text-foreground">Batch No.</Label>
            <Input
              value={batchNumber}
              onChange={(e) => setBatchNumber(e.target.value)}
              className="mt-1.5"
            />
          </div>

          <div>
            <p className="mb-2 border-b pb-2 text-sm text-muted-foreground">Shipment request</p>
            {/* Três colunas irmãs de mesma largura — antes Factory e Ship
                requirement dividiam metade da linha e saíam menores que Category. */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label className="text-foreground">Category</Label>
                <div className="mt-1.5">
                  <SearchSelect
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
                  <SearchSelect
                    value={factoryId}
                    onChange={setFactoryId}
                    options={visibleFactories}
                    placeholder="Select factory"
                  />
                </div>
              </div>
              <div>
                <Label className="text-foreground">Ship requirement</Label>
                <DatePicker
                  value={shipRequirement}
                  onChange={(v) => setShipRequirement(v ?? "")}
                  // Mesma altura padrão (h-8) do SearchSelect ao lado — os três
                  // campos da linha ficam do mesmo tamanho.
                  className="mt-1.5"
                />
              </div>
            </div>
            {/* Roxo (variant default) assim que Category+Factory+Ship req.
                estão preenchidos; antes disso fica outline e desabilitado. */}
            <Button
              variant={canAdd ? "default" : "outline"}
              className="mt-3 w-full"
              onClick={addRow}
              disabled={!canAdd || pending}
            >
              <Plus />
              Add
            </Button>

            <div className="mt-3 overflow-hidden rounded-lg border">
              <div className="hidden grid-cols-[1fr_1fr_1fr_1fr_auto] gap-x-3 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500 sm:grid">
                <span>Category</span>
                <span>Factory</span>
                <span>Ship req.</span>
                <span>Batch No.</span>
                <span />
              </div>
              {pageRows.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">No entries yet.</p>
              ) : (
                pageRows.map((r) => (
                  <div
                    key={r.id}
                    className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 border-t px-3 py-2 text-sm sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:gap-y-0"
                  >
                    <SmallField label="Category" className="max-sm:col-start-1">
                      <span className="block truncate text-slate-700">{r.category_name}</span>
                    </SmallField>
                    <SmallField label="Factory" className="max-sm:col-start-1">
                      <span className="block truncate text-slate-700">{r.factory_name}</span>
                    </SmallField>
                    <SmallField label="Ship req." className="max-sm:col-start-1">
                      <span className="text-slate-700">
                        {formatDateNumeric(r.ship_requirement)}
                      </span>
                    </SmallField>
                    <SmallField label="Batch No." className="max-sm:col-start-1">
                      <span className="text-slate-700">{batch?.batch_number}</span>
                    </SmallField>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-rose-500 hover:text-rose-600 max-sm:col-start-2 max-sm:row-start-1"
                      aria-label="Delete"
                      disabled={pending}
                      onClick={() => removeRow(r.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))
              )}
              <RowsPagination page={page} setPage={setPage} total={rows.length} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            className="sm:min-w-32"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button className="sm:min-w-32" onClick={save} disabled={pending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type PendingRow = {
  tempId: string;
  category_id: string;
  category_name: string;
  factory_id: string;
  factory_name: string;
  ship_requirement: string;
};

function CreateBatchModal({
  open,
  onOpenChange,
  orderId,
  nextBatchNumber,
  categories,
  factories,
  factoriesByCategory,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  nextBatchNumber: string;
  categories: Ref[];
  factories: Ref[];
  factoriesByCategory: Record<string, string[]>;
  onCreated: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [batchNumber, setBatchNumber] = useState(nextBatchNumber);
  const [categoryId, setCategoryId] = useState("");
  const [factoryId, setFactoryId] = useState("");
  const [shipRequirement, setShipRequirement] = useState("");
  const [rows, setRows] = useState<PendingRow[]>([]);

  const [syncedOpen, setSyncedOpen] = useState(false);
  if (open !== syncedOpen) {
    setSyncedOpen(open);
    if (open) {
      setBatchNumber(nextBatchNumber);
      setCategoryId("");
      setFactoryId("");
      setShipRequirement("");
      setRows([]);
    }
  }

  const visibleFactories = factoriesForCategory(factories, categoryId, factoriesByCategory);
  const canAdd = !!categoryId && !!factoryId && !!shipRequirement;

  /** Trocar de categoria descarta a fábrica que não pertence à nova. */
  function selectCategory(id: string) {
    setCategoryId(id);
    const allowed = factoriesForCategory(factories, id, factoriesByCategory);
    if (factoryId && !allowed.some((f) => f.id === factoryId)) setFactoryId("");
  }

  function addRow() {
    if (!canAdd) return;
    const category_name = categories.find((c) => c.id === categoryId)?.name ?? "";
    const factory_name = factories.find((f) => f.id === factoryId)?.name ?? "";
    setRows((prev) => [
      ...prev,
      {
        tempId: `${Date.now()}-${Math.random()}`,
        category_id: categoryId,
        category_name,
        factory_id: factoryId,
        factory_name,
        ship_requirement: shipRequirement,
      },
    ]);
    setCategoryId("");
    setFactoryId("");
    setShipRequirement("");
  }

  function removeRow(tempId: string) {
    setRows((prev) => prev.filter((r) => r.tempId !== tempId));
  }

  function create() {
    if (!batchNumber.trim()) {
      toast.error("Batch No. is required.");
      return;
    }
    startTransition(async () => {
      const res = await createBatch(orderId, {
        batch_number: batchNumber.trim(),
        rows: rows.map(({ category_id, factory_id, ship_requirement }) => ({
          category_id,
          factory_id,
          ship_requirement,
        })),
      });
      if (res.ok) {
        toast.success("Batch created.");
        onCreated();
        onOpenChange(false);
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg text-primary">Create batch</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="mb-2 border-b pb-2 text-sm text-muted-foreground">Main information</p>
            <Label className="text-foreground">Batch No.</Label>
            <Input
              value={batchNumber}
              onChange={(e) => setBatchNumber(e.target.value)}
              className="mt-1.5"
            />
          </div>

          <div>
            <p className="mb-2 border-b pb-2 text-sm text-muted-foreground">Shipment request</p>
            {/* Três colunas irmãs de mesma largura — antes Factory e Ship
                requirement dividiam metade da linha e saíam menores que Category. */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label className="text-foreground">Category</Label>
                <div className="mt-1.5">
                  <SearchSelect
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
                  <SearchSelect
                    value={factoryId}
                    onChange={setFactoryId}
                    options={visibleFactories}
                    placeholder="Select factory"
                  />
                </div>
              </div>
              <div>
                <Label className="text-foreground">Ship requirement</Label>
                <DatePicker
                  value={shipRequirement}
                  onChange={(v) => setShipRequirement(v ?? "")}
                  // Mesma altura padrão (h-8) do SearchSelect ao lado — os três
                  // campos da linha ficam do mesmo tamanho.
                  className="mt-1.5"
                />
              </div>
            </div>
            <Button
              variant={canAdd ? "default" : "outline"}
              className="mt-3 w-full"
              onClick={addRow}
              disabled={!canAdd}
            >
              <Plus />
              Add
            </Button>

            <div className="mt-3 overflow-hidden rounded-lg border">
              <div className="hidden grid-cols-[1fr_1fr_1fr_1fr_auto] gap-x-3 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500 sm:grid">
                <span>Category</span>
                <span>Factory</span>
                <span>Ship req.</span>
                <span>Batch No.</span>
                <span />
              </div>
              {rows.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">No entries yet.</p>
              ) : (
                rows.map((r) => (
                  <div
                    key={r.tempId}
                    className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 border-t px-3 py-2 text-sm sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:gap-y-0"
                  >
                    <SmallField label="Category" className="max-sm:col-start-1">
                      <span className="block truncate text-slate-700">{r.category_name}</span>
                    </SmallField>
                    <SmallField label="Factory" className="max-sm:col-start-1">
                      <span className="block truncate text-slate-700">{r.factory_name}</span>
                    </SmallField>
                    <SmallField label="Ship req." className="max-sm:col-start-1">
                      <span className="text-slate-700">
                        {formatDateNumeric(r.ship_requirement)}
                      </span>
                    </SmallField>
                    <SmallField label="Batch No." className="max-sm:col-start-1">
                      <span className="text-slate-700">{batchNumber}</span>
                    </SmallField>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-rose-500 hover:text-rose-600 max-sm:col-start-2 max-sm:row-start-1"
                      aria-label="Delete"
                      onClick={() => removeRow(r.tempId)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            className="sm:min-w-32"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button className="sm:min-w-32" onClick={create} disabled={pending}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AttachmentsSection({
  orderId,
  step,
}: {
  orderId: string;
  step: ChecklistStepRow;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    startTransition(async () => {
      const res = await uploadStepAttachment(orderId, step.id, formData);
      if (res.ok) {
        setOpen(true);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function download(a: { file_path: string }) {
    startTransition(async () => {
      const res = await getAttachmentDownloadUrl(a.file_path);
      if (res.ok) window.open(res.url, "_blank");
      else toast.error(res.error);
    });
  }

  function removeAttachment(a: { id: string; file_path: string }) {
    startTransition(async () => {
      const res = await deleteStepAttachment(orderId, a.id, a.file_path);
      if (res.ok) router.refresh();
      else toast.error(res.error);
    });
  }

  return (
    <>
      <input ref={inputRef} type="file" className="hidden" onChange={handleFile} />
      <AttachedDocuments
        attachments={step.attachments}
        pending={pending}
        open={open}
        onOpenChange={setOpen}
        onDownload={download}
        onAttach={() => inputRef.current?.click()}
        onRemove={removeAttachment}
      />
    </>
  );
}

export function OrderDetailClient({
  orderId,
  order,
  batches,
  ofc,
  etdByOfc,
  categories,
  factories,
  factoriesByCategory,
  profiles,
  steps,
  viewPrefs,
  currentUserId,
}: {
  orderId: string;
  order: OrderDetail;
  batches: BatchRow[];
  ofc: OfcRow[];
  etdByOfc: Record<string, EtdInfoRow>;
  categories: Ref[];
  factories: Ref[];
  factoriesByCategory: Record<string, string[]>;
  profiles: Ref[];
  steps: ChecklistStepRow[];
  /** Preferências de visualização do usuário — não restringem nada. */
  viewPrefs: ViewPrefs;
  currentUserId: string;
}) {
  const router = useRouter();
  const [infoOpen, setInfoOpen] = useState(true);
  const [expandAll, setExpandAll] = useState(false);
  const [openSteps, setOpenSteps] = useState<Set<ChecklistStep>>(new Set());
  const [viewBatch, setViewBatch] = useState<BatchRow | null>(null);
  const [editBatch, setEditBatch] = useState<BatchRow | null>(null);
  const [createBatchOpen, setCreateBatchOpen] = useState(false);
  const [factoryCategoryOpen, setFactoryCategoryOpen] = useState(false);
  const nextBatchNumber = `.${String(batches.length + 1).padStart(2, "0")}`;

  // ETD: exige "Initial date" em TODAS as entradas Factory×Category. Sem
  // nenhuma entrada não há o que preencher, então o requisito não é cumprido.
  const etdInitialFilled =
    ofc.length > 0 && ofc.every((o) => !!etdByOfc[o.id]?.initial_date);

  // `done` do banco é só o espelho de `completed_on`; quem decide se a etapa
  // está concluída é a regra de lib/checklist-completion, que também consulta
  // anexos, entradas Factory×Category e ETD. Derivado aqui, uma vez.
  const checkedSteps = useMemo(() => {
    const piDocs = piDocumentRequired(order.type);
    // Place the Order agrupa por fábrica e exige um doc em CADA uma — quantas
    // fábricas o pedido tem e, por etapa, quantas já têm anexo.
    const placeOrderFactoryIds = new Set(ofc.map((o) => o.factory_id));
    return steps.map((s) => {
      const facts: ChecklistFacts = {
        completedOn: s.completed_on,
        attachments: s.attachments.length,
        factoryCategoryCount: ofc.length,
        etdInitialFilled,
        piDocumentRequired: piDocs,
      };
      if (s.step === "place_the_order") {
        facts.placeOrderFactoriesTotal = placeOrderFactoryIds.size;
        facts.placeOrderFactoriesWithDoc = new Set(
          s.attachments
            .map((a) => a.factory_id)
            .filter((id): id is string => !!id && placeOrderFactoryIds.has(id))
        ).size;
      }
      return { ...s, facts, done: isStepChecked(s.step, facts) };
    });
  }, [steps, ofc, etdInitialFilled, order.type]);

  // Só o que é RENDERIZADO passa pelo filtro. `steps` continua inteiro para
  // qualquer regra que dependa do checklist completo — esconder uma etapa é
  // preferência de leitura, não pode mudar o comportamento da tela.
  const visibleSteps = useMemo(
    () => filterSteps(checkedSteps, viewPrefs, currentUserId),
    [checkedSteps, viewPrefs, currentUserId]
  );

  const isStepOpen = (step: ChecklistStep) => expandAll || openSteps.has(step);
  function toggleStep(step: ChecklistStep) {
    setOpenSteps((prev) => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });
  }

  function saveBatchStatus(batch: BatchRow, status: BatchStatus) {
    startBatchTransition(async () => {
      const res = await updateBatchStatus(orderId, batch.id, status);
      if (res.ok) router.refresh();
      else toast.error(res.error);
    });
  }
  const [, startBatchTransition] = useTransition();

  function saveStepField(
    step: ChecklistStepRow,
    patch: Parameters<typeof updateChecklistStep>[2]
  ) {
    startStepTransition(async () => {
      const res = await updateChecklistStep(orderId, step.id, patch);
      if (res.ok) router.refresh();
      else toast.error(res.error);
    });
  }
  const [stepPending, startStepTransition] = useTransition();

  return (
    <div>
      {/* Sem "Download CSV" aqui: o checklist do Order nunca previu exportação
          (erro de design confirmado pelo cliente no QA de 05/08). */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="outline"
          className="h-11 rounded-xl"
          onClick={() => router.push("/orders")}
        >
          <ArrowLeft />
          Back
        </Button>
      </div>

      <div className="mb-6 rounded-2xl border bg-white">
        <CollapsiblePrimitive.Root open={infoOpen} onOpenChange={setInfoOpen}>
          <CollapsiblePrimitive.Trigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between px-4 py-5 text-left sm:px-6"
            >
              <div>
                <p className="text-lg font-semibold text-foreground">
                  Table information
                </p>
                <p className="text-sm text-muted-foreground">
                  Informational data for consultation
                </p>
              </div>
              <ChevronDown
                className={`size-5 text-slate-400 transition-transform ${
                  infoOpen ? "rotate-180" : ""
                }`}
              />
            </button>
          </CollapsiblePrimitive.Trigger>
          <CollapsiblePrimitive.Content className="border-t px-4 py-5 sm:px-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <InfoCard title="Main information">
                <div className="grid grid-cols-2 gap-3">
                  <InfoField label="PO Number" value={order.po_number} />
                  <InfoField label="Date PO" value={formatDateNumeric(order.date_po)} />
                </div>
                <InfoField
                  label="Status"
                  value={<StatusPill label={ORDER_STATUS_LABELS[order.status]} />}
                />
                <InfoField label="Order Type" value={order.type} />
                <InfoField
                  label="Schedule Req."
                  value={formatDateNumeric(order.schedule_requested)}
                />
              </InfoCard>
              <InfoCard title="Customer information">
                <div className="grid grid-cols-2 gap-3">
                  <InfoField label="Client" value={order.client} />
                  <InfoField
                    label="Status"
                    value={<StatusPill label={ORDER_STATUS_LABELS[order.status]} />}
                  />
                </div>
                <InfoField label="Client reference" value={order.client_reference} />
                <InfoField label="Business Unit" value={order.bu} />
              </InfoCard>
              <InfoCard title="Responsible">
                <ResponsibleRow name={order.leader} role="Leader" />
                <ResponsibleRow name={order.requester} role="Requester" />
                <ResponsibleRow name={order.exporter} role="Exporter" />
              </InfoCard>
            </div>
          </CollapsiblePrimitive.Content>
        </CollapsiblePrimitive.Root>
      </div>

      <div className="mb-6 overflow-hidden rounded-2xl border bg-white">
        <div className="flex items-center gap-3 border-b bg-slate-50/80 px-4 py-3 text-xs font-semibold text-slate-500 sm:px-6 lg:grid lg:grid-cols-[1fr_1fr_150px]">
          <span className="flex-1 lg:flex-none">
            <span className="lg:hidden">Batches</span>
            <span className="hidden lg:inline">Batch No.</span>
          </span>
          <span className="hidden lg:inline">Status</span>
          <Button variant="outline" size="sm" onClick={() => setCreateBatchOpen(true)}>
            Create batch
            <Plus className="size-3.5" />
          </Button>
        </div>
        {batches.length === 0 ? (
          <p className="px-6 py-6 text-sm text-muted-foreground">
            No batches for this order.
          </p>
        ) : (
          batches.map((b) => {
            const editable = EDITABLE_BATCH_STATUSES.includes(b.status);
            const rows = ofc.filter((r) => r.batch_id === b.id);
            return (
              <div
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3.5 text-sm last:border-b-0 sm:px-6 lg:grid lg:grid-cols-[1fr_1fr_150px] lg:gap-3"
              >
                <span className="font-medium text-slate-700 lg:font-normal">
                  {b.batch_number}
                </span>
                <div className="order-last w-full lg:order-none lg:w-auto lg:justify-self-start">
                  {editable ? (
                    <BatchStatusSelect
                      value={b.status}
                      onChange={(status) => saveBatchStatus(b, status)}
                    />
                  ) : (
                    <StatusPill label={BATCH_STATUS_LABELS[b.status]} />
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {editable && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Edit batch"
                      onClick={() => setEditBatch(b)}
                    >
                      <Pencil className="size-4 text-slate-400" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="View batch"
                    onClick={() => setViewBatch(b)}
                  >
                    <Eye className="size-4 text-slate-400" />
                  </Button>
                </div>
                {viewBatch?.id === b.id && (
                  <ViewBatchModal
                    open
                    onOpenChange={(o) => !o && setViewBatch(null)}
                    batch={b}
                    rows={rows}
                  />
                )}
                {editBatch?.id === b.id && (
                  <EditBatchModal
                    open
                    onOpenChange={(o) => !o && setEditBatch(null)}
                    orderId={orderId}
                    batch={b}
                    rows={rows}
                    categories={categories}
                    factories={factories}
                    factoriesByCategory={factoriesByCategory}
                    onSaved={() => router.refresh()}
                  />
                )}
              </div>
            );
          })
        )}
        <CreateBatchModal
          open={createBatchOpen}
          onOpenChange={setCreateBatchOpen}
          orderId={orderId}
          nextBatchNumber={nextBatchNumber}
          categories={categories}
          factories={factories}
          factoriesByCategory={factoriesByCategory}
          onCreated={() => router.refresh()}
        />
      </div>

      <div className="rounded-2xl border bg-white">
        <div className="flex items-center justify-between px-4 py-5 sm:px-6">
          <p className="text-lg font-semibold text-foreground">Order progress</p>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-800"
            onClick={() => {
              setExpandAll((v) => !v);
              setOpenSteps(new Set());
            }}
          >
            {expandAll ? "Collapse all" : "Expand all"}
            {expandAll ? (
              <ChevronsDownUp className="size-4" />
            ) : (
              <ChevronsUpDown className="size-4" />
            )}
          </button>
        </div>
        <div className="border-t">
          {visibleSteps.length === 0 ? (
            <p className="px-6 py-6 text-sm text-muted-foreground">
              {steps.length === 0
                ? "No checklist steps for this order."
                : "No steps match your checklist view preferences."}
            </p>
          ) : (
            visibleSteps.map((s) => {
              // Etapa desligada nunca aparece expandida: some se estava aberta e
              // trava — só volta a abrir se religarem pelo toggle.
              const open = s.enabled && isStepOpen(s.step);
              const facts = s.facts;
              return (
                <div key={s.step} className="border-b last:border-b-0">
                  <div className="flex items-center gap-4 px-4 py-4 sm:px-6">
                    <StepIcon
                      enabled={s.enabled}
                      checked={s.done}
                      gated={hasExtraRequirements(s.step, facts)}
                      // Etapa desligada não se aplica a este pedido: não há o
                      // que cobrar dela.
                      title={s.enabled ? missingLabel(s.step, facts) : undefined}
                    />
                    <button
                      type="button"
                      disabled={!s.enabled}
                      className={`flex-1 text-left text-sm font-medium disabled:cursor-default ${
                        s.enabled ? "text-slate-800" : "text-slate-400"
                      }`}
                      onClick={() => toggleStep(s.step)}
                    >
                      {STEP_LABELS[s.step]}
                    </button>
                    {TOGGLEABLE_STEPS.has(s.step) && (
                      <Switch
                        checked={s.enabled}
                        disabled={stepPending}
                        onCheckedChange={(checked) =>
                          saveStepField(s, { enabled: checked })
                        }
                      />
                    )}
                    <button
                      type="button"
                      aria-label={open ? "Collapse" : "Expand"}
                      disabled={!s.enabled}
                      className="disabled:cursor-default disabled:opacity-40"
                      onClick={() => toggleStep(s.step)}
                    >
                      <ChevronDown
                        className={`size-4 text-slate-400 transition-transform ${
                          open ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                  </div>
                  {open && (
                    <div className="space-y-4 bg-slate-50/60 px-4 py-4 sm:px-6 sm:pl-15">
                      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                        <div>
                          <Label className="text-xs text-muted-foreground">
                            Estimated date
                          </Label>
                          <DatePicker
                            value={s.estimated_date}
                            disabled={stepPending}
                            onChange={(v) => {
                              if (v !== (s.estimated_date ?? null))
                                saveStepField(s, { estimated_date: v });
                            }}
                            className="mt-1 bg-white"
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">
                            Responsible
                          </Label>
                          <Select
                            value={s.responsible_id ?? ""}
                            onValueChange={(v) =>
                              saveStepField(s, { responsible_id: v || null })
                            }
                          >
                            <SelectTrigger className="mt-1 w-full bg-white">
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              {profiles.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">
                            Completed on
                          </Label>
                          {/* Sem "Estimated date" não há o que concluir. Etapa
                              antiga que já tem a conclusão segue editável, pra
                              não ficar presa com o campo travado. */}
                          <DatePicker
                            value={s.completed_on}
                            disabled={
                              stepPending || (!s.estimated_date && !s.completed_on)
                            }
                            placeholder={
                              s.estimated_date ? "dd/mm/yyyy" : "Set the estimated date"
                            }
                            onChange={(v) => {
                              if (v !== (s.completed_on ?? null))
                                saveStepField(s, { completed_on: v });
                            }}
                            className="mt-1 bg-white"
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">
                            Signed by
                          </Label>
                          {/* Travado: quem conclui a etapa (Completed on) assina —
                              preenchido pelo servidor, não editável aqui. */}
                          <Select value={s.signed_by_id ?? ""} disabled>
                            <SelectTrigger className="mt-1 w-full bg-white">
                              <SelectValue placeholder="—" />
                            </SelectTrigger>
                            <SelectContent>
                              {profiles.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {s.step === "place_the_order" ? (
                        <PlaceOrderFactoryGroups
                          orderId={orderId}
                          stepId={s.id}
                          ofc={ofc}
                          batches={batches}
                          attachments={s.attachments}
                        />
                      ) : s.step === "etd" ? (
                        <EtdStepTable
                          orderId={orderId}
                          ofc={ofc}
                          batches={batches}
                          etdByOfc={etdByOfc}
                          factories={factories}
                        />
                      ) : (
                        <AttachmentsSection orderId={orderId} step={s} />
                      )}
                      {s.step === "po" && (
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full justify-center border-dashed bg-white"
                          onClick={() => setFactoryCategoryOpen(true)}
                        >
                          <Plus className="size-3.5" />
                          Factory x Category
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <FactoryCategoryModal
        open={factoryCategoryOpen}
        onOpenChange={setFactoryCategoryOpen}
        orderId={orderId}
        batches={batches}
        ofc={ofc}
        categories={categories}
        factories={factories}
        factoriesByCategory={factoriesByCategory}
        onChanged={() => router.refresh()}
      />
    </div>
  );
}
