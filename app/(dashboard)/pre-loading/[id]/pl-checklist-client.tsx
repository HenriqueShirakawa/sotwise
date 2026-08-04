"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Paperclip,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { formatDateNumeric } from "@/lib/format";
import { BATCH_STATUS_LABELS } from "@/lib/status-colors";
import type { BatchStatus, ChecklistStep } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/status-pill";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  deletePreLoadingStepAttachment,
  getPreLoadingAttachmentUrl,
  savePreLoadingStep,
  uploadPreLoadingStepAttachment,
  type StepPatch,
} from "./actions";
import { ConfirmShippingModal, type ShipmentLine } from "./confirm-shipping-modal";

export type Ref = { id: string; name: string };

export type PreLoadingDetail = {
  id: string;
  pl_number: string;
  created_date: string;
  client_reference: string | null;
  clients: string[];
  pod: string | null;
  leader: string | null;
  responsible_signer: string | null;
  booking_status: string | null;
  seal_number: string | null;
};

export type PlBatchRow = {
  id: string;
  client: string | null;
  po_number: string;
  batch_number: string;
  status: BatchStatus;
};

export type StepAttachment = { id: string; file_name: string | null; file_path: string };

export type PlStepRow = {
  step: ChecklistStep;
  done: boolean;
  attachments: StepAttachment[];
  estimated_date: string | null;
  responsible_id: string | null;
  completed_on: string | null;
  signed_by_id: string | null;
  consolidation_point_id: string | null;
  city_id: string | null;
  pol_id: string | null;
  carrier_agent_id: string | null;
  agent_brazil_id: string | null;
  agent_china_id: string | null;
  contact_brazil_id: string | null;
  contact_china_id: string | null;
  booking_number: string | null;
};

/** As 7 etapas da fase pre-loading, na ordem do Bubble (docs §3.9.5). */
const STEP_LABELS: Partial<Record<ChecklistStep, string>> = {
  consolidation_point: "Consolidation Point",
  city: "City",
  port_of_loading: "Port of Loading",
  shipping_docs: "Shipping Docs",
  agents: "Agents",
  booking: "Booking",
  loading_date: "Loading Date",
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

/**
 * Mesmos estados do checklist de Orders: verde ✓ = concluída (aqui, derivada
 * de `completed_on` preenchido) · azul = em andamento.
 */
/** Mesma bolinha do checklist de Orders: halo claro + miolo menor. */
function StepIcon({ done }: { done: boolean }) {
  return done ? (
    <CheckCircle2 className="size-5 shrink-0 fill-emerald-600 text-white" />
  ) : (
    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-100">
      <span className="size-2 rounded-full bg-blue-600" />
    </span>
  );
}

/** "Attached documents" da etapa — mesmo comportamento do checklist de Orders. */
function AttachmentsSection({
  preLoadingId,
  step,
  attachments,
}: {
  preLoadingId: string;
  step: ChecklistStep;
  attachments: StepAttachment[];
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
      const res = await uploadPreLoadingStepAttachment(preLoadingId, step, formData);
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
      const res = await getPreLoadingAttachmentUrl(a.file_path);
      if (res.ok) window.open(res.url, "_blank");
      else toast.error(res.error);
    });
  }

  function remove(a: StepAttachment) {
    startTransition(async () => {
      const res = await deletePreLoadingStepAttachment(preLoadingId, a.id, a.file_path);
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder = "Select",
  disabled = false,
}: {
  label: string;
  value: string | null;
  options: Ref[];
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value ?? ""} onValueChange={(v) => onChange(v || null)} disabled={disabled}>
        <SelectTrigger className="mt-1 w-full bg-white">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function PlChecklistClient({
  preLoading,
  batches,
  steps,
  profiles,
  factories,
  cities,
  pols,
  agentsBrazil,
  agentsChina,
  agents,
  contactsByAgent,
  carriers,
  shipmentModels,
  shipmentLines,
  currentUserId,
  preloadingLeaderId,
  alreadyShipped,
}: {
  preLoading: PreLoadingDetail;
  batches: PlBatchRow[];
  steps: PlStepRow[];
  profiles: Ref[];
  factories: Ref[];
  cities: Ref[];
  pols: Ref[];
  agentsBrazil: Ref[];
  agentsChina: Ref[];
  agents: Ref[];
  contactsByAgent: Record<string, Ref[]>;
  carriers: Ref[];
  shipmentModels: Ref[];
  shipmentLines: ShipmentLine[];
  currentUserId: string;
  preloadingLeaderId: string | null;
  alreadyShipped: boolean;
}) {
  const router = useRouter();
  const [infoOpen, setInfoOpen] = useState(true);
  const [expandAll, setExpandAll] = useState(false);
  const [openSteps, setOpenSteps] = useState<Set<ChecklistStep>>(new Set());
  const [shipOpen, setShipOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const isStepOpen = (step: ChecklistStep) => expandAll || openSteps.has(step);
  function toggleStep(step: ChecklistStep) {
    setOpenSteps((prev) => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });
  }

  function save(step: ChecklistStep, patch: StepPatch) {
    startTransition(async () => {
      const res = await savePreLoadingStep(preLoading.id, step, patch);
      if (res.ok) router.refresh();
      else toast.error(res.error);
    });
  }

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="outline"
          className="h-11 rounded-xl"
          onClick={() => router.push("/pre-loading")}
        >
          <ArrowLeft />
          Back
        </Button>
        <div className="text-right">
          <p className="text-lg font-semibold text-foreground">PL - {preLoading.pl_number}</p>
          <p className="text-sm text-muted-foreground">
            {doneCount} of {steps.length} steps completed
          </p>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border bg-white">
        <CollapsiblePrimitive.Root open={infoOpen} onOpenChange={setInfoOpen}>
          <CollapsiblePrimitive.Trigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between px-6 py-5 text-left"
            >
              <div>
                <p className="text-lg font-semibold text-foreground">Table information</p>
                <p className="text-sm text-muted-foreground">
                  Informational data for consultation — edit it from the list
                </p>
              </div>
              <ChevronDown
                className={`size-5 text-slate-400 transition-transform ${
                  infoOpen ? "rotate-180" : ""
                }`}
              />
            </button>
          </CollapsiblePrimitive.Trigger>
          <CollapsiblePrimitive.Content className="border-t px-6 py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <InfoCard title="Main information">
                <div className="grid grid-cols-2 gap-3">
                  <InfoField label="PL number" value={preLoading.pl_number} />
                  <InfoField
                    label="Date PL"
                    value={formatDateNumeric(preLoading.created_date)}
                  />
                </div>
                <InfoField label="POD (Port of Discharge)" value={preLoading.pod} />
              </InfoCard>
              <InfoCard title="Responsible">
                <ResponsibleRow name={preLoading.leader} role="Leader" />
                <ResponsibleRow
                  name={preLoading.responsible_signer}
                  role="Responsible and Signer"
                />
                <ResponsibleRow
                  name={preLoading.client_reference}
                  role="Client(s) Reference"
                />
              </InfoCard>
            </div>
          </CollapsiblePrimitive.Content>
        </CollapsiblePrimitive.Root>
      </div>

      <div className="mb-6 overflow-hidden rounded-2xl border bg-white">
        <div className="grid grid-cols-[1fr_1fr_1fr] gap-3 border-b bg-slate-50/80 px-6 py-3 text-xs font-semibold text-slate-500">
          <span>Client</span>
          <span>Order Number . Batches</span>
          <span>Status</span>
        </div>
        {batches.length === 0 ? (
          <p className="px-6 py-6 text-sm text-muted-foreground">
            No batches linked to this pre-loading.
          </p>
        ) : (
          batches.map((b) => (
            <div
              key={b.id}
              className="grid grid-cols-[1fr_1fr_1fr] items-center gap-3 border-b px-6 py-3.5 text-sm last:border-b-0"
            >
              <span className="text-slate-700">{b.client ?? "—"}</span>
              <span className="text-slate-700">
                {b.po_number} {b.batch_number}
              </span>
              <span className="justify-self-start">
                <StatusPill label={BATCH_STATUS_LABELS[b.status]} />
              </span>
            </div>
          ))
        )}
      </div>

      <div className="rounded-2xl border bg-white">
        <div className="flex items-center justify-between px-6 py-5">
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
          {steps.map((s) => {
            const open = isStepOpen(s.step);
            return (
              <div key={s.step} className="border-b last:border-b-0">
                <div className="flex items-center gap-4 px-6 py-4">
                  <StepIcon done={s.done} />
                  <button
                    type="button"
                    className="flex-1 text-left text-sm font-medium text-slate-800"
                    onClick={() => toggleStep(s.step)}
                  >
                    {STEP_LABELS[s.step]}
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
                  <div className="space-y-4 bg-slate-50/60 px-6 py-4 pl-15">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                      <div>
                        <Label className="text-xs text-muted-foreground">Estimated date</Label>
                        <Input
                          type="date"
                          defaultValue={s.estimated_date ?? ""}
                          disabled={pending}
                          onBlur={(e) => {
                            const v = e.target.value || null;
                            if (v !== (s.estimated_date ?? null))
                              save(s.step, { estimated_date: v });
                          }}
                          className="mt-1 bg-white"
                        />
                      </div>
                      <SelectField
                        label="Responsible"
                        value={s.responsible_id}
                        options={profiles}
                        onChange={(v) => save(s.step, { responsible_id: v })}
                      />
                      <div>
                        <Label className="text-xs text-muted-foreground">Completed on</Label>
                        <Input
                          type="date"
                          defaultValue={s.completed_on ?? ""}
                          disabled={pending}
                          onBlur={(e) => {
                            const v = e.target.value || null;
                            if (v !== (s.completed_on ?? null))
                              save(s.step, { completed_on: v });
                          }}
                          className="mt-1 bg-white"
                        />
                      </div>
                      {/* Travado: quem conclui a etapa (Completed on) assina —
                          preenchido pelo servidor, não editável aqui. */}
                      <SelectField
                        label="Signed by"
                        value={s.signed_by_id}
                        options={profiles}
                        placeholder="—"
                        disabled
                        onChange={() => {}}
                      />
                    </div>

                    {s.step === "consolidation_point" && (
                      <SelectField
                        label="Consolidation Point"
                        value={s.consolidation_point_id}
                        options={factories}
                        placeholder="Select consolidation point"
                        onChange={(v) => save(s.step, { consolidation_point_id: v })}
                      />
                    )}
                    {s.step === "city" && (
                      <SelectField
                        label="City"
                        value={s.city_id}
                        options={cities}
                        placeholder="Select city"
                        onChange={(v) => save(s.step, { city_id: v })}
                      />
                    )}
                    {s.step === "port_of_loading" && (
                      <SelectField
                        label="Port of Loading"
                        value={s.pol_id}
                        options={pols}
                        placeholder="Select Port of Loading"
                        onChange={(v) => save(s.step, { pol_id: v })}
                      />
                    )}
                    {s.step === "agents" && (
                      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
                        <SelectField
                          label="Carrier agent"
                          value={s.carrier_agent_id}
                          options={agents}
                          placeholder="Select carrier agent"
                          onChange={(v) => save(s.step, { carrier_agent_id: v })}
                        />
                        <SelectField
                          label="Agent Brazil"
                          value={s.agent_brazil_id}
                          options={agentsBrazil}
                          placeholder="Select agent Brazil"
                          onChange={(v) =>
                            // Trocar o agente invalida o contato dele.
                            save(s.step, { agent_brazil_id: v, contact_brazil_id: null })
                          }
                        />
                        <SelectField
                          label="Agent China"
                          value={s.agent_china_id}
                          options={agentsChina}
                          placeholder="Select agent China"
                          onChange={(v) =>
                            save(s.step, { agent_china_id: v, contact_china_id: null })
                          }
                        />
                        <SelectField
                          label="Contact Brazil"
                          value={s.contact_brazil_id}
                          options={
                            s.agent_brazil_id ? (contactsByAgent[s.agent_brazil_id] ?? []) : []
                          }
                          placeholder={
                            s.agent_brazil_id ? "Select contact Brazil" : "Pick an agent first"
                          }
                          onChange={(v) => save(s.step, { contact_brazil_id: v })}
                        />
                        <SelectField
                          label="Contact China"
                          value={s.contact_china_id}
                          options={
                            s.agent_china_id ? (contactsByAgent[s.agent_china_id] ?? []) : []
                          }
                          placeholder={
                            s.agent_china_id ? "Select contact China" : "Pick an agent first"
                          }
                          onChange={(v) => save(s.step, { contact_china_id: v })}
                        />
                      </div>
                    )}
                    {s.step === "booking" && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Booking number</Label>
                        <Input
                          defaultValue={s.booking_number ?? ""}
                          disabled={pending}
                          placeholder="Booking number"
                          onBlur={(e) => {
                            const v = e.target.value.trim() || null;
                            if (v !== (s.booking_number ?? null))
                              save(s.step, { booking_number: v });
                          }}
                          className="mt-1 bg-white"
                        />
                      </div>
                    )}

                    <AttachmentsSection
                      preLoadingId={preLoading.id}
                      step={s.step}
                      attachments={s.attachments}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* "Confirm Shipping" só libera com as 7 etapas concluídas (docs §3.9.6);
          abre o modal que cria o Shipment. Um PL já confirmado fica travado. */}
      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        <Button
          variant="outline"
          className="h-11 min-w-48 rounded-xl"
          onClick={() => router.push("/pre-loading")}
        >
          Cancel
        </Button>
        <Button
          className="h-11 min-w-64 rounded-xl"
          disabled={alreadyShipped || doneCount < steps.length}
          onClick={() => setShipOpen(true)}
        >
          {alreadyShipped ? "Shipping confirmed" : "Confirm Shipping"}
        </Button>
      </div>

      {shipOpen && (
        <ConfirmShippingModal
          onClose={() => setShipOpen(false)}
          preLoadingId={preLoading.id}
          plNumber={preLoading.pl_number}
          clientReference={preLoading.client_reference}
          sealNumber={preLoading.seal_number}
          loadingDate={steps.find((s) => s.step === "loading_date")?.estimated_date ?? null}
          preloadingLeaderId={preloadingLeaderId}
          currentUserId={currentUserId}
          profiles={profiles}
          carriers={carriers}
          shipmentModels={shipmentModels}
          lines={shipmentLines}
        />
      )}
    </div>
  );
}
