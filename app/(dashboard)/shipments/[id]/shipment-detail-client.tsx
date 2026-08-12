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
  Lock,
  Paperclip,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { formatDateNumeric } from "@/lib/format";
import { filterSteps, type ViewPrefs } from "@/lib/view-prefs";
import { BATCH_STATUS_LABELS } from "@/lib/status-colors";
import type { BatchStatus, ChecklistStep } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/date-picker";
import { StatusPill } from "@/components/status-pill";
import { RowField } from "@/components/data-cards";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";

import {
  deleteShipment,
  deleteShipmentStepAttachment,
  getShipmentAttachmentUrl,
  saveShipmentStep,
  uploadShipmentStepAttachment,
  type ShipmentStepPatch,
} from "./actions";
import { ViewPartsModal, type PartRow } from "./view-parts-modal";

export type Ref = { id: string; name: string };

export type ShipmentDetail = {
  id: string;
  pre_loading_id: string;
  pl_number: string;
  created_date: string;
  client_reference: string | null;
  clients: string[];
  pod: string | null;
  ship_model: string | null;
  carrier: string | null;
  container_number: string | null;
  leader: string | null;
  signer: string | null;
  status: string;
};

export type ShipmentBatchRow = {
  id: string;
  client: string | null;
  po_number: string;
  batch_number: string;
  status: BatchStatus;
  order_date: string | null;
  /** Entradas Factory × Category do lote — chips na tabela e linhas do modal. */
  parts: PartRow[];
};

export type StepAttachment = { id: string; file_name: string | null; file_path: string };

export type ShipmentStepRow = {
  step: ChecklistStep;
  done: boolean;
  /** A etapa exige algo além do "Completed on" (ver lib/checklist-completion). */
  gated: boolean;
  /** O que ainda falta pra etapa fechar — tooltip do ícone. */
  missing: string | null;
  attachments: StepAttachment[];
  estimated_date: string | null;
  responsible: string | null;
  responsible_id: string | null;
  completed_on: string | null;
  signed_by: string | null;
  notes: string | null;
  /** Só nas etapas herdadas do PL — texto já resolvido pro read-only. */
  detail: string | null;
};

/**
 * A timeline completa (docs §3.10.4): #11–17 vêm do Pre-loading e aqui são só
 * consulta; #18–24 são as etapas da fase Shipment, editáveis nesta tela.
 */
const PRE_LOADING_STEPS: ChecklistStep[] = [
  "consolidation_point",
  "city",
  "port_of_loading",
  "shipping_docs",
  "agents",
  "booking",
  "loading_date",
];

const STEP_LABELS: Partial<Record<ChecklistStep, string>> = {
  consolidation_point: "Consolidation Point",
  city: "City",
  port_of_loading: "Port of Loading",
  shipping_docs: "Shipping Docs",
  agents: "Agents",
  booking: "Booking",
  loading_date: "Loading Date",
  shipping_date: "Shipping Date",
  bl: "BL",
  original_docs: "Original Docs",
  inspection_report: "Inspection Report",
  eta_brazil: "ETA Brazil",
  ata_brazil: "ATA Brazil",
  delivered: "Delivered",
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
        <p className="text-sm font-medium text-slate-800">{name ?? "—"}</p>
        <p className="text-xs text-muted-foreground">{role}</p>
      </div>
    </div>
  );
}

/** Fábricas do lote como chips, com "+N" quando passa de três (igual ao Bubble). */
function FactoryChips({ parts }: { parts: PartRow[] }) {
  const names = parts.map((p) => p.factory);
  const shown = names.slice(0, 3);
  const extra = names.length - shown.length;
  if (!names.length) return <span className="text-slate-300">—</span>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {shown.map((name, i) => (
        <span
          key={i}
          className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
        >
          {name}
        </span>
      ))}
      {extra > 0 && (
        <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          +{extra}
        </span>
      )}
    </span>
  );
}

/**
 * Mesma bolinha das outras telas: verde ✓ = concluída · "i" laranja = falta a
 * exigência própria da etapa (documento, cadastro, booking) · azul = em andamento.
 */
function StepIcon({
  done,
  gated,
  title,
}: {
  done: boolean;
  gated: boolean;
  title?: string;
}) {
  const icon = done ? (
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

/** "Attached documents" — sem Attach/excluir nas etapas herdadas do PL. */
function AttachmentsSection({
  shipmentId,
  preLoadingId,
  step,
  attachments,
  readOnly,
}: {
  shipmentId: string;
  preLoadingId: string;
  step: ChecklistStep;
  attachments: StepAttachment[];
  readOnly: boolean;
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
      const res = await uploadShipmentStepAttachment(shipmentId, preLoadingId, step, formData);
      if (res.ok) {
        setOpen(true);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function download(a: StepAttachment) {
    startTransition(async () => {
      const res = await getShipmentAttachmentUrl(a.file_path);
      if (res.ok) window.open(res.url, "_blank");
      else toast.error(res.error);
    });
  }

  function remove(a: StepAttachment) {
    startTransition(async () => {
      const res = await deleteShipmentStepAttachment(shipmentId, a.id, a.file_path);
      if (res.ok) router.refresh();
      else toast.error(res.error);
    });
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <Paperclip className="size-4 text-slate-400" />
        <button
          type="button"
          className="text-xs text-muted-foreground enabled:hover:text-slate-700"
          disabled={attachments.length === 0}
          onClick={() => setOpen((v) => !v)}
        >
          Attached documents
        </button>
        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
          {attachments.length} docs
        </span>
        {attachments.length > 0 && (
          <ChevronDown
            className={`size-3.5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
        {!readOnly && (
          <>
            <input ref={inputRef} type="file" className="hidden" onChange={handleFile} />
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              disabled={pending}
              onClick={() => inputRef.current?.click()}
            >
              <Plus className="size-3.5" />
              Attach
            </Button>
          </>
        )}
      </div>
      {open && attachments.length > 0 && (
        <div className="mt-2 space-y-1">
          {attachments.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between rounded-md bg-white px-3 py-1.5 text-sm"
            >
              <button
                type="button"
                className="truncate text-primary hover:underline"
                disabled={pending}
                onClick={() => download(a)}
              >
                {a.file_name ?? "File"}
              </button>
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-rose-500 hover:text-rose-600"
                  aria-label="Delete attachment"
                  disabled={pending}
                  onClick={() => remove(a)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ShipmentDetailClient({
  shipment,
  batches,
  steps,
  profiles,
  factories,
  dates,
  canDelete,
  viewPrefs,
  currentUserId,
}: {
  shipment: ShipmentDetail;
  batches: ShipmentBatchRow[];
  steps: ShipmentStepRow[];
  profiles: Ref[];
  /** Exige o `delete` da feature Shipments (ver deleteShipment) — sem isso o
   * botão só daria erro. */
  canDelete: boolean;
  /** Preferências de visualização do usuário — não restringem nada. */
  viewPrefs: ViewPrefs;
  currentUserId: string;
  /** Repassado ao modal de ETD aberto pelo "View parts". */
  factories: Ref[];
  dates: {
    loading: string | null;
    shipment: string | null;
    eta: string | null;
    delivery: string | null;
  };
}) {
  const router = useRouter();
  const [infoOpen, setInfoOpen] = useState(true);
  const [expandAll, setExpandAll] = useState(false);
  const [openSteps, setOpenSteps] = useState<Set<ChecklistStep>>(new Set());
  const [partsOf, setPartsOf] = useState<ShipmentBatchRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  // Só o que é RENDERIZADO passa pelo filtro. `steps` continua inteiro para o
  // contador de progresso — esconder etapa é preferência de leitura.
  const visibleSteps = useMemo(
    () => filterSteps(steps, viewPrefs, currentUserId),
    [steps, viewPrefs, currentUserId]
  );

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteShipment(shipment.id);
      if (res.ok) {
        toast.success("Shipment deleted.");
        router.push("/shipments");
      } else {
        toast.error(res.error);
        setConfirmDelete(false);
      }
    });
  }

  const isStepOpen = (step: ChecklistStep) => expandAll || openSteps.has(step);
  function toggleStep(step: ChecklistStep) {
    setOpenSteps((prev) => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });
  }

  function save(step: ChecklistStep, patch: ShipmentStepPatch) {
    startTransition(async () => {
      const res = await saveShipmentStep(shipment.id, shipment.pre_loading_id, step, patch);
      if (res.ok) router.refresh();
      else toast.error(res.error);
    });
  }

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            className="h-11 rounded-xl"
            onClick={() => router.push("/shipments")}
          >
            <ArrowLeft />
            Back
          </Button>
          {canDelete ? (
            <Button
              variant="outline"
              className="h-11 rounded-xl text-rose-600 hover:text-rose-700"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 />
              Delete shipment
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <StatusPill label={shipment.status} />
          <div className="text-right">
            <p className="text-lg font-semibold text-foreground">PL - {shipment.pl_number}</p>
            <p className="text-sm text-muted-foreground">
              {doneCount} of {steps.length} steps completed
            </p>
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border bg-white">
        <CollapsiblePrimitive.Root open={infoOpen} onOpenChange={setInfoOpen}>
          <CollapsiblePrimitive.Trigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between px-4 py-5 text-left sm:px-6"
            >
              <div>
                <p className="text-lg font-semibold text-foreground">Table information</p>
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
                  <InfoField label="PL number" value={shipment.pl_number} />
                  <InfoField label="Date PL" value={formatDateNumeric(shipment.created_date)} />
                </div>
                <InfoField label="Client(s)" value={shipment.clients.join(", ") || null} />
                <InfoField label="POD (Port of Discharge)" value={shipment.pod} />
                <InfoField label="Client(s) Reference" value={shipment.client_reference} />
              </InfoCard>
              <InfoCard title="Transport">
                <div className="grid grid-cols-2 gap-3">
                  <InfoField label="Ship Model" value={shipment.ship_model} />
                  <InfoField label="Carrier" value={shipment.carrier} />
                </div>
                <InfoField label="Container Number" value={shipment.container_number} />
                <div className="grid grid-cols-2 gap-3">
                  <InfoField label="Loading date" value={formatDateNumeric(dates.loading)} />
                  <InfoField label="Shipment date" value={formatDateNumeric(dates.shipment)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <InfoField label="ETA" value={formatDateNumeric(dates.eta)} />
                  <InfoField label="Delivery date" value={formatDateNumeric(dates.delivery)} />
                </div>
              </InfoCard>
              <InfoCard title="Responsible">
                <ResponsibleRow name={shipment.leader} role="Leader's Shipment" />
                <ResponsibleRow name={shipment.signer} role="Signer" />
              </InfoCard>
            </div>
          </CollapsiblePrimitive.Content>
        </CollapsiblePrimitive.Root>
      </div>

      <div className="mb-6 overflow-hidden rounded-2xl border bg-white">
        <p className="border-b bg-slate-50/80 px-6 py-3 text-sm font-medium text-slate-700">
          Batches in shipment container
        </p>
        <div className="hidden grid-cols-[1fr_1fr_1fr_2fr_15rem] gap-3 border-b px-6 py-3 text-xs font-semibold text-slate-500 lg:grid">
          <span>Client</span>
          <span>PO Number . Batches</span>
          <span>Order date</span>
          <span>Factories</span>
          <span />
        </div>
        {batches.length === 0 ? (
          <p className="px-6 py-6 text-sm text-muted-foreground">
            No batches linked to this shipment.
          </p>
        ) : (
          batches.map((b) => (
            <div
              key={b.id}
              className="grid grid-cols-2 gap-3 border-b px-4 py-3.5 text-sm last:border-b-0 sm:px-6 lg:grid-cols-[1fr_1fr_1fr_2fr_15rem] lg:items-center"
            >
              <RowField label="Client">
                <span className="text-slate-700">{b.client ?? "—"}</span>
              </RowField>
              <RowField label="PO Number . Batches">
                <span className="text-slate-700">
                  {b.po_number} {b.batch_number}
                </span>
              </RowField>
              <RowField label="Order date">
                <span className="text-slate-600">{formatDateNumeric(b.order_date)}</span>
              </RowField>
              <RowField label="Factories" className="max-lg:col-span-2">
                <FactoryChips parts={b.parts} />
              </RowField>
              <div className="col-span-2 flex flex-wrap items-center gap-2 lg:col-span-1 lg:justify-self-end">
                <StatusPill label={BATCH_STATUS_LABELS[b.status]} />
                <Button variant="outline" size="sm" onClick={() => setPartsOf(b)}>
                  <Eye className="size-3.5" />
                  View parts
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <ViewPartsModal
        open={!!partsOf}
        onOpenChange={(o) => !o && setPartsOf(null)}
        poBatch={partsOf ? `${partsOf.po_number} ${partsOf.batch_number}` : ""}
        parts={partsOf?.parts ?? []}
        factories={factories}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(false)}
        title="Delete shipment?"
        description={`Shipment PL-${shipment.pl_number} will be deleted. Its batches return to the Pre-loading, which reappears in the list to be confirmed again.`}
        confirmLabel="Delete"
        destructive
        loading={pending}
        onConfirm={handleDelete}
      />

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
          {visibleSteps.length === 0 && steps.length > 0 ? (
            <p className="px-6 py-6 text-sm text-muted-foreground">
              No steps match your checklist view preferences.
            </p>
          ) : null}
          {visibleSteps.map((s) => {
            const open = isStepOpen(s.step);
            // Etapas #11–17 são consulta: a edição delas acontecia enquanto o
            // PL ainda estava na tela de Pre-loading (docs §3.10.4).
            const readOnly = PRE_LOADING_STEPS.includes(s.step);
            return (
              <div key={s.step} className="border-b last:border-b-0">
                <div className="flex items-center gap-4 px-4 py-4 sm:px-6">
                  <StepIcon done={s.done} gated={s.gated} title={s.missing ?? undefined} />
                  <button
                    type="button"
                    className="flex flex-1 items-center gap-2 text-left text-sm font-medium text-slate-800"
                    onClick={() => toggleStep(s.step)}
                  >
                    {STEP_LABELS[s.step]}
                    {readOnly && (
                      <Lock className="size-3.5 text-slate-400" aria-label="Read-only" />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={open ? "Collapse" : "Expand"}
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
                    {readOnly ? (
                      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                        <InfoField
                          label="Estimated date"
                          value={formatDateNumeric(s.estimated_date)}
                        />
                        <InfoField label="Responsible" value={s.responsible} />
                        <InfoField
                          label="Completed on"
                          value={formatDateNumeric(s.completed_on)}
                        />
                        <InfoField label="Signed by" value={s.signed_by} />
                        {s.detail && (
                          <div className="col-span-2 sm:col-span-4">
                            <InfoField label={STEP_LABELS[s.step] ?? ""} value={s.detail} />
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                          <div>
                            <Label className="text-xs text-muted-foreground">
                              Estimated date
                            </Label>
                            <DatePicker
                              value={s.estimated_date}
                              disabled={pending}
                              onChange={(v) => {
                                if (v !== (s.estimated_date ?? null))
                                  save(s.step, { estimated_date: v });
                              }}
                              className="mt-1 bg-white"
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Responsible</Label>
                            <Select
                              value={s.responsible_id ?? ""}
                              onValueChange={(v) => save(s.step, { responsible_id: v || null })}
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
                            <Label className="text-xs text-muted-foreground">Completed on</Label>
                            {/* Sem "Estimated date" não há o que concluir. Etapa
                                antiga que já tem a conclusão segue editável, pra
                                não ficar presa com o campo travado. */}
                            <DatePicker
                              value={s.completed_on}
                              disabled={
                                pending || (!s.estimated_date && !s.completed_on)
                              }
                              placeholder={
                                s.estimated_date ? "dd/mm/yyyy" : "Set the estimated date"
                              }
                              onChange={(v) => {
                                if (v !== (s.completed_on ?? null))
                                  save(s.step, { completed_on: v });
                              }}
                              className="mt-1 bg-white"
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Signed by</Label>
                            {/* Assinatura é de quem conclui — preenchida no save. */}
                            <Input
                              value={s.signed_by ?? ""}
                              disabled
                              placeholder="Set when completed"
                              className="mt-1 bg-muted"
                            />
                          </div>
                        </div>

                        {s.step === "original_docs" && (
                          <div>
                            <Label className="text-xs text-muted-foreground">Notes</Label>
                            <Textarea
                              defaultValue={s.notes ?? ""}
                              disabled={pending}
                              placeholder="Notes"
                              onBlur={(e) => {
                                const v = e.target.value.trim() || null;
                                if (v !== (s.notes ?? null)) save(s.step, { notes: v });
                              }}
                              className="mt-1 bg-white"
                            />
                          </div>
                        )}
                      </>
                    )}

                    <AttachmentsSection
                      shipmentId={shipment.id}
                      preLoadingId={shipment.pre_loading_id}
                      step={s.step}
                      attachments={s.attachments}
                      readOnly={readOnly}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
