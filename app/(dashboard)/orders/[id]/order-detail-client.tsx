"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Circle,
  AlertCircle,
  Download,
  Eye,
} from "lucide-react";
import { toast } from "sonner";

import { formatDate, formatDateNumeric } from "@/lib/format";
import { BATCH_STATUS_LABELS, ORDER_STATUS_LABELS } from "@/lib/status-colors";
import type { BatchStatus, ChecklistStep, OrderStatus } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { StatusPill } from "@/components/status-pill";

const STEP_LABELS: Record<ChecklistStep, string> = {
  order: "Order",
  po: "PO",
  pi: "PI",
  deposit_payment: "Deposit payment",
  packing_confirm: "Packing confirmation",
  condition_confirm: "Condition confirmation",
  place_the_order: "Place the order",
  etd: "ETD",
  balance_payment: "Balance payment",
  pre_loading: "Pre-loading",
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

export type ChecklistStepRow = {
  step: ChecklistStep;
  enabled: boolean;
  done: boolean;
  estimated_date: string | null;
  completed_on: string | null;
  responsible: string | null;
  signed_by: string | null;
};

type OrderDetail = {
  po_number: string;
  bu: string | null;
  type: string | null;
  client: string | null;
  client_reference: string | null;
  requester: string | null;
  leader: string | null;
  exporter: string | null;
  date_create: string;
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

function StepIcon({ enabled, done }: { enabled: boolean; done: boolean }) {
  if (!enabled) return <Circle className="size-5 fill-slate-300 text-slate-300" />;
  if (done)
    return <CheckCircle2 className="size-5 fill-emerald-600 text-white" />;
  return <AlertCircle className="size-5 text-amber-500" />;
}

export function OrderDetailClient({
  order,
  batches,
  steps,
}: {
  order: OrderDetail;
  batches: { batch_number: string; status: BatchStatus }[];
  steps: ChecklistStepRow[];
}) {
  const router = useRouter();
  const [infoOpen, setInfoOpen] = useState(false);
  const [expandAll, setExpandAll] = useState(false);
  const [openSteps, setOpenSteps] = useState<Set<ChecklistStep>>(new Set());

  const isStepOpen = (step: ChecklistStep) => expandAll || openSteps.has(step);
  function toggleStep(step: ChecklistStep) {
    setOpenSteps((prev) => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="outline"
          className="h-11 rounded-xl"
          onClick={() => router.push("/orders")}
        >
          <ArrowLeft />
          Back
        </Button>
        <Button
          className="h-11 rounded-xl px-5"
          onClick={() => toast.info("Download CSV — coming soon.")}
        >
          <Download />
          Download CSV
        </Button>
      </div>

      <div className="mb-6 rounded-2xl border bg-white">
        <CollapsiblePrimitive.Root open={infoOpen} onOpenChange={setInfoOpen}>
          <CollapsiblePrimitive.Trigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between px-6 py-5 text-left"
            >
              <div>
                <p className="text-lg font-semibold text-foreground">
                  Table information
                </p>
                <p className="text-sm text-muted-foreground">
                  Open to see more information
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
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              <InfoField label="PO No." value={order.po_number} />
              <InfoField label="BU" value={order.bu} />
              <InfoField label="Type" value={order.type} />
              <InfoField label="Client" value={order.client} />
              <InfoField label="Client Ref." value={order.client_reference} />
              <InfoField label="Requester" value={order.requester} />
              <InfoField label="Leader" value={order.leader} />
              <InfoField label="Exporter" value={order.exporter} />
              <InfoField label="Date Create Order" value={formatDate(order.date_create)} />
              <InfoField
                label="Schedule Req."
                value={formatDateNumeric(order.schedule_requested)}
              />
              <InfoField
                label="Status PO"
                value={<StatusPill label={ORDER_STATUS_LABELS[order.status]} />}
              />
            </div>
          </CollapsiblePrimitive.Content>
        </CollapsiblePrimitive.Root>
      </div>

      <div className="mb-6 overflow-hidden rounded-2xl border bg-white">
        <div className="grid grid-cols-2 border-b bg-slate-50/80 px-6 py-3 text-xs font-semibold text-slate-500">
          <span>Batch No.</span>
          <span>Status</span>
        </div>
        {batches.length === 0 ? (
          <p className="px-6 py-6 text-sm text-muted-foreground">
            No batches for this order.
          </p>
        ) : (
          batches.map((b) => (
            <div
              key={b.batch_number}
              className="grid grid-cols-2 items-center border-b px-6 py-3.5 text-sm last:border-b-0"
            >
              <span className="text-slate-700">{b.batch_number}</span>
              <div className="flex items-center justify-between pr-2">
                <StatusPill label={BATCH_STATUS_LABELS[b.status]} />
                <Eye className="size-4 text-slate-400" aria-hidden />
              </div>
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
          {steps.length === 0 ? (
            <p className="px-6 py-6 text-sm text-muted-foreground">
              No checklist steps for this order.
            </p>
          ) : (
            steps.map((s) => {
              const open = isStepOpen(s.step);
              return (
                <div key={s.step} className="border-b last:border-b-0">
                  <div className="flex items-center gap-4 px-6 py-4">
                    <StepIcon enabled={s.enabled} done={s.done} />
                    <button
                      type="button"
                      className={`flex-1 text-left text-sm font-medium ${
                        s.enabled ? "text-slate-800" : "text-slate-400"
                      }`}
                      onClick={() => toggleStep(s.step)}
                    >
                      {STEP_LABELS[s.step]}
                    </button>
                    <Switch checked={s.enabled} disabled />
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
                    <div className="grid grid-cols-2 gap-x-6 gap-y-3 bg-slate-50/60 px-6 py-4 pl-15 sm:grid-cols-4">
                      <InfoField
                        label="Estimated Date"
                        value={formatDateNumeric(s.estimated_date)}
                      />
                      <InfoField
                        label="Completed On"
                        value={formatDateNumeric(s.completed_on)}
                      />
                      <InfoField label="Responsible" value={s.responsible} />
                      <InfoField label="Signed By" value={s.signed_by} />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
