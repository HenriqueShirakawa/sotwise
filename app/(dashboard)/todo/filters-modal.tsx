"use client";

import { useState } from "react";

import { ORDER_STATUS_LABELS } from "@/lib/status-colors";
import {
  STEP_LABELS,
  CHECKLIST_STEP_ORDER,
  ORDER_STEPS,
  PRELOADING_STEPS,
  SHIPMENT_STEPS,
} from "@/lib/checklist";
import type { ChecklistStep, OrderStatus } from "@/types/database";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/date-picker";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/search-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type Ref = { id: string; name: string };

/** Aba ativa da To do list — restringe as opções do filtro de Step. */
export type StepPhase = "all" | "order" | "preloading" | "shipment";

export type TodoFilters = {
  client_id: string;
  status: string;
  step: string;
  date_from: string;
  date_to: string;
};

export const EMPTY_FILTERS: TodoFilters = {
  client_id: "",
  status: "",
  step: "",
  date_from: "",
  date_to: "",
};

export function activeFilterCount(filters: TodoFilters): number {
  return Object.values(filters).filter((v) => v !== "").length;
}

/** Enums viram opções {id,name} pro SearchSelect (mesma UI dos cadastros). */
const STATUS_OPTIONS: Ref[] = (
  Object.entries(ORDER_STATUS_LABELS) as [OrderStatus, string][]
).map(([id, name]) => ({ id, name }));

const STEPS_BY_PHASE: Record<StepPhase, ChecklistStep[]> = {
  all: CHECKLIST_STEP_ORDER,
  order: ORDER_STEPS,
  preloading: PRELOADING_STEPS,
  shipment: SHIPMENT_STEPS,
};

/** Opções do filtro de Step conforme a aba ativa (§3.12.2). */
function stepOptions(phase: StepPhase): Ref[] {
  return STEPS_BY_PHASE[phase].map((step) => ({ id: step, name: STEP_LABELS[step] }));
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <p className="border-b pb-2 text-sm text-muted-foreground">{title}</p>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-foreground">{label}</Label>
      {children}
    </div>
  );
}

export function FiltersModal({
  open,
  onOpenChange,
  filters,
  onApply,
  onClear,
  clients,
  phase,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: TodoFilters;
  onApply: (filters: TodoFilters) => void;
  onClear: () => void;
  clients: Ref[];
  /** Aba ativa — restringe as opções do filtro de Step. */
  phase: StepPhase;
}) {
  const [draft, setDraft] = useState<TodoFilters>(filters);

  // Ressincroniza o rascunho com os filtros ativos toda vez que o modal abre.
  const [syncedOpen, setSyncedOpen] = useState(false);
  if (open !== syncedOpen) {
    setSyncedOpen(open);
    if (open) setDraft(filters);
  }

  const set = <K extends keyof TodoFilters>(key: K, value: TodoFilters[K]) =>
    setDraft((f) => ({ ...f, [key]: value }));

  function apply() {
    onApply(draft);
    onOpenChange(false);
  }

  function clear() {
    setDraft(EMPTY_FILTERS);
    onClear();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg text-primary">Filters</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <Section title="Order Information">
            <Field label="Client">
              <SearchSelect
                value={draft.client_id}
                onChange={(v) => set("client_id", v)}
                options={clients}
                placeholder="Choose some clients"
              />
            </Field>
            <Field label="Status">
              <SearchSelect
                value={draft.status}
                onChange={(v) => set("status", v)}
                options={STATUS_OPTIONS}
                placeholder="Choose some statuses"
              />
            </Field>
          </Section>

          <Section title="Stage of the Process">
            <Field label="Step">
              <SearchSelect
                value={draft.step}
                onChange={(v) => set("step", v)}
                options={stepOptions(phase)}
                placeholder="Select Step"
              />
            </Field>
            <Field label="Date Estimated">
              <div className="grid grid-cols-2 gap-3">
                <DatePicker
                  value={draft.date_from}
                  onChange={(v) => set("date_from", v ?? "")}
                  placeholder="From"
                  ariaLabel="From"
                />
                <DatePicker
                  value={draft.date_to}
                  onChange={(v) => set("date_to", v ?? "")}
                  placeholder="To"
                  ariaLabel="To"
                />
              </div>
            </Field>
          </Section>
        </div>

        <DialogFooter>
          <Button variant="outline" className="sm:min-w-32" onClick={clear}>
            Clear Filters
          </Button>
          <Button className="sm:min-w-32" onClick={apply}>
            Filter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
