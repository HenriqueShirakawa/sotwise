"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  Info,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { formatDateNumeric, todayIso } from "@/lib/format";
import { uploadDirect } from "@/lib/attachments-client";
import { triggerDownload } from "@/lib/download";
import { filterSteps, type ViewPrefs } from "@/lib/view-prefs";
import {
  hasExtraRequirements,
  isStepChecked,
  missingLabel,
  TRIGGER_COMPLETED_STEPS,
  type ChecklistFacts,
} from "@/lib/checklist-completion";
import {
  BATCH_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  STATUS_COLORS,
} from "@/lib/status-colors";
import type { BatchStatus, ChecklistStep, LoadingStatus, OrderStatus } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { StatusPill } from "@/components/status-pill";
import { SearchSelect, SEARCHABLE_FROM } from "@/components/search-select";
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
  deleteStepAttachment,
  getAttachmentDownloadUrl,
  updateBatchStatus,
  updateChecklistStep,
  createStepAttachmentTicket,
  registerStepAttachment,
} from "./actions";
import { FactoryCategoryModal } from "./factory-category-modal";
import { PlaceOrderFactoryGroups } from "./place-order-groups";
import { EtdStepTable } from "./etd-step";
import { StepEmailSection } from "@/components/checklist/step-email-section";
import { StepLogButton, useStepLogCounts } from "@/components/checklist/step-log-section";
import { RevisionBadge, StepRevisionsModal, type RevisionStep } from "./step-revisions";

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

// Só lotes em In Negotiation/In Production têm o status editável na tela — uma
// vez em Pre-Loading pra frente, quem mexe é o fluxo de PL/Shipment.
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
  /** Order/PO/PI: quantas revisões a etapa tem (badge). */
  revision_count: number;
  /** Order/PO/PI: data do registro original (o painel mostra a 1ª data). */
  revision_original_date: string | null;
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

export type BatchRow = {
  id: string;
  batch_number: string;
  status: BatchStatus;
  split_from_batch_id: string | null;
};

export type Ref = { id: string; name: string };

type OrderDetail = {
  po_number: string;
  bu: string | null;
  type: string | null;
  client: string | null;
  client_reference: string | null;
  requester: string | null;
  leader: string | null;
  operational_responsible: string | null;
  exporter: string | null;
  date_po: string | null;
  /** Etapa Order: data do pedido final (a vigente, após revisões). */
  order_received_date: string | null;
  /** Etapa PI: último status vindo do GSS + data. */
  pi_status: string | null;
  pi_status_date: string | null;
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
  hasFactoryCategory,
}: {
  value: BatchStatus;
  onChange: (value: BatchStatus) => void;
  /** Lote sem nenhuma linha de Factory x Category ainda não pode ir pra
   *  Production — desabilita a opção aqui pra não depender só do erro do
   *  servidor (`updateBatchStatus`, que continua sendo a fonte de verdade). */
  hasFactoryCategory: boolean;
}) {
  const label = BATCH_STATUS_LABELS[value];
  const hex = STATUS_COLORS[label] ?? "#475569";
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as BatchStatus)}
      style={{ borderColor: `${hex}59`, color: hex }}
      className="h-7 max-w-[220px] rounded-[4px] border bg-white px-1.5 text-xs font-medium"
      title={hasFactoryCategory ? undefined : "Add a Factory x Category entry before moving this batch to Production"}
    >
      {EDITABLE_BATCH_STATUSES.map((s) => (
        <option key={s} value={s} disabled={s === "in_production" && !hasFactoryCategory}>
          {BATCH_STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

const ROWS_PAGE_SIZE = 10;

/** Ordena por Category, depois Factory — mesmo critério do modal Factory x Category. */
function sortByCategoryFactory<T extends OfcRow>(rows: T[]): T[] {
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

/**
 * "Completed on" das etapas Order/PO/PI (20/10/2026): concluem pelo próprio
 * gatilho, sem exigir Estimated date. Campo TRAVADO para todos — Order vem do
 * "Order received date", PO/PI do GSS; só admin/owner corrige PO/PI, com
 * motivo, pelo popup de revisões.
 */
function TriggerCompletedOn({
  step,
  canCorrect,
  onRevise,
}: {
  step: ChecklistStepRow;
  canCorrect: boolean;
  onRevise: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <Label className="text-xs text-muted-foreground">Completed on</Label>
        {step.step === "po" && (
          <RevisionBadge count={step.revision_count} onClick={onRevise} />
        )}
        {step.step !== "order" && canCorrect && (
          <button
            type="button"
            className="text-xs font-medium text-primary hover:underline"
            onClick={onRevise}
          >
            {step.completed_on ? "Revise" : "Set"}
          </button>
        )}
      </div>
      <DatePicker
        value={step.completed_on}
        disabled
        placeholder={step.step === "order" ? "Set the received date" : "Set automatically"}
        onChange={() => {}}
        className="mt-1 bg-white"
      />
    </div>
  );
}

/** Etapa Order: "Order received date" (1ª data) + badge de revisões + "+". */
function OrderReceivedDateField({
  date,
  revisions,
  onOpen,
}: {
  date: string | null;
  revisions: number;
  onOpen: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-white px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">Order received date</p>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-sm font-medium text-slate-800">
            {date ? formatDateNumeric(date) : "Not set"}
          </span>
          <RevisionBadge count={revisions} onClick={onOpen} />
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onOpen}>
        <Plus className="size-3.5" />
        {date ? "Revise" : "Set date"}
      </Button>
    </div>
  );
}

/** Etapa PI: último status vindo do GSS + data + badge de revisões. */
function PiStatusField({
  status,
  date,
  revisions,
  onOpen,
}: {
  status: string | null;
  date: string | null;
  revisions: number;
  onOpen: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-white px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">PI status (GSS)</p>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-sm font-medium text-slate-800">
            {status ? `${status} · ${formatDateNumeric(date)}` : "Not received yet"}
          </span>
          <RevisionBadge count={revisions} onClick={onOpen} />
        </div>
      </div>
      {status && (
        <Button type="button" variant="ghost" size="sm" onClick={onOpen}>
          Details
        </Button>
      )}
    </div>
  );
}

/** Documentos antigos de PO/PI — só leitura (a etapa não aceita mais anexo). */
function ReadOnlyAttachments({ attachments }: { attachments: ChecklistStepRow["attachments"] }) {
  const [pending, startTransition] = useTransition();
  function download(a: { file_path: string; file_name?: string | null }) {
    startTransition(async () => {
      const res = await getAttachmentDownloadUrl(a.file_path, a.file_name);
      if (res.ok) triggerDownload(res.url, a.file_name);
      else toast.error(res.error);
    });
  }
  return <AttachedDocuments attachments={attachments} pending={pending} onDownload={download} />;
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
    startTransition(async () => {
      const res = await uploadDirect(
        file,
        (name, size) => createStepAttachmentTicket(orderId, step.id, name, size),
        (path) => registerStepAttachment(orderId, step.id, path, file.name)
      );
      if (res.ok) {
        setOpen(true);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function download(a: { file_path: string; file_name?: string | null }) {
    startTransition(async () => {
      const res = await getAttachmentDownloadUrl(a.file_path, a.file_name);
      if (res.ok) triggerDownload(res.url, a.file_name);
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
  loadedByBatch,
  factories,
  profiles,
  steps,
  viewPrefs,
  currentUserId,
  canCorrectCompletedOn,
}: {
  orderId: string;
  order: OrderDetail;
  batches: BatchRow[];
  ofc: OfcRow[];
  etdByOfc: Record<string, EtdInfoRow>;
  /** Carregamento congelado no embarque: lote → entrada → Total/Partial/None. */
  loadedByBatch: Record<string, Record<string, LoadingStatus>>;
  factories: Ref[];
  profiles: Ref[];
  steps: ChecklistStepRow[];
  /** Preferências de visualização do usuário — não restringem nada. */
  viewPrefs: ViewPrefs;
  currentUserId: string;
  /** Admin/owner: corrige o "Completed on" travado das etapas com gatilho. */
  canCorrectCompletedOn: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Vindo do "Check" da To do list (?step=): abre só essa etapa e rola até
  // ela — lido uma vez só (inicializador preguiçoso do useState, não muda
  // depois de montado mesmo que a URL mude).
  const [deepLinkStep] = useState<ChecklistStep | null>(
    () => (searchParams.get("step") as ChecklistStep | null) ?? null
  );
  const [infoOpen, setInfoOpen] = useState(true);
  const [openSteps, setOpenSteps] = useState<Set<ChecklistStep>>(
    () => new Set(deepLinkStep ? [deepLinkStep] : [])
  );
  const [viewBatch, setViewBatch] = useState<BatchRow | null>(null);
  const [factoryCategoryOpen, setFactoryCategoryOpen] = useState(false);
  // Popup de revisões das etapas Order/PO/PI.
  const [revisionsFor, setRevisionsFor] = useState<ChecklistStepRow | null>(null);
  // Contador do History no cabeçalho de cada etapa (recarrega a cada save).
  const logCounts = useStepLogCounts({ kind: "order", orderId }, JSON.stringify(steps));

  useEffect(() => {
    if (!deepLinkStep) return;
    document
      .getElementById(`step-${deepLinkStep}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // No Confirm Shipping a entrada Partial/None sai do lote embarcado e migra
  // para um lote-filho (split, docs §3.7.2). O lote que embarcou continua sendo
  // o dono daquela linha — ela é o que ele carregou/pediu — então o "View batch"
  // do lote precisa mostrá-la mesmo depois de migrada, subindo pela linhagem
  // `split_from_batch_id`. Sem isto o lote embarcado aparece vazio. Cada lote
  // "possui" a si mesmo + todos os descendentes do split (cadeia de vários
  // níveis: o filho embarca e splita de novo).
  const ownedBatchIds = useMemo(() => {
    const childrenOf = new Map<string, string[]>();
    for (const b of batches) {
      if (!b.split_from_batch_id) continue;
      const arr = childrenOf.get(b.split_from_batch_id) ?? [];
      arr.push(b.id);
      childrenOf.set(b.split_from_batch_id, arr);
    }
    const map = new Map<string, Set<string>>();
    for (const b of batches) {
      const owned = new Set<string>([b.id]);
      const stack = [...(childrenOf.get(b.id) ?? [])];
      let guard = 0;
      while (stack.length && guard++ < 100) {
        const id = stack.pop()!;
        if (owned.has(id)) continue;
        owned.add(id);
        stack.push(...(childrenOf.get(id) ?? []));
      }
      map.set(b.id, owned);
    }
    return map;
  }, [batches]);

  // ETD: exige "Initial date" em TODAS as entradas Factory×Category. Sem
  // nenhuma entrada não há o que preencher, então o requisito não é cumprido.
  const etdInitialFilled =
    ofc.length > 0 && ofc.every((o) => !!etdByOfc[o.id]?.initial_date);

  // `done` do banco é só o espelho de `completed_on`; quem decide se a etapa
  // está concluída é a regra de lib/checklist-completion, que também consulta
  // anexos, entradas Factory×Category e ETD. Derivado aqui, uma vez.
  const checkedSteps = useMemo(() => {
    // Place the Order agrupa por fábrica e exige um doc em CADA uma — quantas
    // fábricas o pedido tem e, por etapa, quantas já têm anexo.
    const placeOrderFactoryIds = new Set(ofc.map((o) => o.factory_id));
    return steps.map((s) => {
      const facts: ChecklistFacts = {
        completedOn: s.completed_on,
        attachments: s.attachments.length,
        factoryCategoryCount: ofc.length,
        etdInitialFilled,
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
  }, [steps, ofc, etdInitialFilled]);

  // Só o que é RENDERIZADO passa pelo filtro. `steps` continua inteiro para
  // qualquer regra que dependa do checklist completo — esconder uma etapa é
  // preferência de leitura, não pode mudar o comportamento da tela.
  const visibleSteps = useMemo(
    () => filterSteps(checkedSteps, viewPrefs, currentUserId),
    [checkedSteps, viewPrefs, currentUserId]
  );

  // "Expand all" só semeia `openSteps` com todas as etapas expansíveis (e limpa
  // no "Collapse all"). O estado por-linha é a única fonte de verdade — sem isso
  // um booleano `expandAll` sobrepunha os toggles e travava o colapso individual.
  const expandableSteps = visibleSteps.filter((s) => s.enabled);
  const allExpanded =
    expandableSteps.length > 0 && expandableSteps.every((s) => openSteps.has(s.step));
  const isStepOpen = (step: ChecklistStep) => openSteps.has(step);
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
                <ResponsibleRow
                  name={order.operational_responsible}
                  role="Operational Responsible"
                />
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
          {/* Sem "Create batch": lote novo só vem do GSS (13/10/2026). */}
          <span aria-hidden className="hidden lg:block" />
        </div>
        {batches.length === 0 ? (
          <p className="px-6 py-6 text-sm text-muted-foreground">
            No batches for this order.
          </p>
        ) : (
          batches.map((b) => {
            const editable = EDITABLE_BATCH_STATUSES.includes(b.status);
            // Linhas fisicamente neste lote (trava do Production no status).
            const ownRows = ofc.filter((r) => r.batch_id === b.id);
            // Visualização inclui as que migraram no split (lote embarcado).
            // A linha é exibida como deste lote — número e status do embarque
            // DELE, não do lote de destino: "no embarque do .01 essa entrada foi
            // Partial" continua verdade depois que ela migrou para o .02.
            const owned = ownedBatchIds.get(b.id) ?? new Set([b.id]);
            const loaded = loadedByBatch[b.id];
            const viewRows: OfcRow[] = ofc
              // Linha de um lote descendente só entra se ESTE lote a carregou
              // (snapshot) — o lote seguinte pode já existir antes do split
              // (lotes espelhados) com linhas próprias, que apareciam aqui como
              // duplicatas "—". Sem snapshot (dado antigo) vale a linhagem.
              .filter(
                (r) =>
                  r.batch_id &&
                  owned.has(r.batch_id) &&
                  (r.batch_id === b.id || !loaded || r.id in loaded)
              )
              .map((r) => ({
                ...r,
                // Sem snapshot (embarque anterior à tabela, ou lote que ainda
                // não embarcou) vale o status atual da linha — e só quando ela
                // é fisicamente deste lote.
                loading_status: loaded?.[r.id] ?? (r.batch_id === b.id ? r.loading_status : null),
              }));
            return (
              <div
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3.5 text-sm last:border-b-0 sm:px-6 lg:grid lg:grid-cols-[1fr_1fr_150px] lg:gap-3"
              >
                <span className="flex items-center gap-2 font-medium text-slate-700 lg:font-normal">
                  {b.batch_number}
                </span>
                <div className="order-last w-full lg:order-none lg:w-auto lg:justify-self-start">
                  {editable ? (
                    <BatchStatusSelect
                      value={b.status}
                      onChange={(status) => saveBatchStatus(b, status)}
                      hasFactoryCategory={ownRows.length > 0}
                    />
                  ) : (
                    <StatusPill label={BATCH_STATUS_LABELS[b.status]} />
                  )}
                </div>
                {/* Sem "Edit batch": número do lote e Factory x Category vêm só do
                    GSS (16/10/2026) — aqui é só consulta. */}
                <div className="flex items-center gap-1">
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
                    rows={viewRows}
                  />
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="rounded-2xl border bg-white">
        <div className="flex items-center justify-between px-4 py-5 sm:px-6">
          <p className="text-lg font-semibold text-foreground">Order progress</p>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-800"
            onClick={() =>
              setOpenSteps(
                allExpanded ? new Set() : new Set(expandableSteps.map((s) => s.step))
              )
            }
          >
            {allExpanded ? "Collapse all" : "Expand all"}
            {allExpanded ? (
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
                <div key={s.step} id={`step-${s.step}`} className="border-b last:border-b-0">
                  <div className="flex items-center gap-4 px-4 py-4 sm:px-6">
                    <StepIcon
                      enabled={s.enabled}
                      checked={s.done}
                      gated={hasExtraRequirements(s.step)}
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
                    <StepLogButton
                      owner={{ kind: "order", stepId: s.id }}
                      count={logCounts[s.step]}
                      stepLabel={STEP_LABELS[s.step]}
                    />
                    {/* Etapa sem toggle reserva o espaço dele (w-9 = Switch),
                        pra o History ficar na mesma coluna em todas as linhas. */}
                    {TOGGLEABLE_STEPS.has(s.step) ? (
                      <Switch
                        checked={s.enabled}
                        disabled={stepPending}
                        onCheckedChange={(checked) =>
                          saveStepField(s, { enabled: checked })
                        }
                      />
                    ) : (
                      <span aria-hidden className="w-9 shrink-0" />
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
                          {/* Lista longa vira campo com busca — o Select do
                              Radix só faz typeahead da primeira letra. */}
                          {profiles.length > SEARCHABLE_FROM ? (
                            <SearchSelect
                              value={s.responsible_id ?? ""}
                              onChange={(v) => saveStepField(s, { responsible_id: v || null })}
                              options={profiles}
                              placeholder="Select"
                              className="mt-1"
                            />
                          ) : (
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
                          )}
                        </div>
                        {TRIGGER_COMPLETED_STEPS.has(s.step) ? (
                          <TriggerCompletedOn
                            step={s}
                            canCorrect={canCorrectCompletedOn}
                            onRevise={() => setRevisionsFor(s)}
                          />
                        ) : (
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
                              // "Completed on" é fato consumado — nunca futuro.
                              max={todayIso()}
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
                        )}
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
                      {s.step === "order" && (
                        <OrderReceivedDateField
                          // O painel mostra a 1ª data; a vigente fica no popup.
                          date={s.revision_original_date ?? order.order_received_date}
                          revisions={s.revision_count}
                          onOpen={() => setRevisionsFor(s)}
                        />
                      )}
                      {s.step === "pi" && (
                        <PiStatusField
                          status={order.pi_status}
                          date={order.pi_status_date}
                          revisions={s.revision_count}
                          onOpen={() => setRevisionsFor(s)}
                        />
                      )}
                      {s.step === "po" || s.step === "pi" ? (
                        // Sem anexo: o GSS gera PO e PI (20/10/2026). Documento
                        // antigo continua visível, só leitura.
                        s.attachments.length > 0 && (
                          <ReadOnlyAttachments attachments={s.attachments} />
                        )
                      ) : s.step === "place_the_order" ? (
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
                      <StepEmailSection
                        owner={{ kind: "order", stepId: s.id }}
                        feature="orders"
                        step={s.step}
                        defaultSubject={`Order #${order.po_number}`}
                        recordPath={`/orders/${orderId}`}
                        responsibleId={s.responsible_id}
                        done={s.done}
                      />
                      {s.step === "po" && (
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full justify-center border-dashed bg-white"
                          onClick={() => setFactoryCategoryOpen(true)}
                        >
                          <Eye className="size-3.5" />
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
        batches={batches}
        ofc={ofc}
      />
      {revisionsFor && (
        <StepRevisionsModal
          open
          onOpenChange={(o) => !o && setRevisionsFor(null)}
          orderId={orderId}
          stepId={revisionsFor.id}
          step={revisionsFor.step as RevisionStep}
          currentDate={
            revisionsFor.step === "order"
              ? order.order_received_date
              : revisionsFor.completed_on
          }
          canCorrect={canCorrectCompletedOn}
        />
      )}
    </div>
  );
}
