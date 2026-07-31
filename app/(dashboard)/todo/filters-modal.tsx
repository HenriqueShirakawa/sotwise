"use client";

import { useState } from "react";

import { ORDER_STATUS_LABELS } from "@/lib/status-colors";
import { STEP_LABELS, CHECKLIST_STEP_ORDER } from "@/lib/checklist";
import type { OrderStatus } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const STEP_OPTIONS: Ref[] = CHECKLIST_STEP_ORDER.map((step) => ({
  id: step,
  name: STEP_LABELS[step],
}));

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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: TodoFilters;
  onApply: (filters: TodoFilters) => void;
  onClear: () => void;
  clients: Ref[];
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

        <div className="space-y-4">
          <Field label="Client">
            <SearchSelect
              value={draft.client_id}
              onChange={(v) => set("client_id", v)}
              options={clients}
              placeholder="Choose some client"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status PO">
              <SearchSelect
                value={draft.status}
                onChange={(v) => set("status", v)}
                options={STATUS_OPTIONS}
                placeholder="Any status"
              />
            </Field>
            <Field label="Step">
              <SearchSelect
                value={draft.step}
                onChange={(v) => set("step", v)}
                options={STEP_OPTIONS}
                placeholder="Any step"
              />
            </Field>
          </div>
          <Field label="Date preview">
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="date"
                value={draft.date_from}
                onChange={(e) => set("date_from", e.target.value)}
              />
              <Input
                type="date"
                value={draft.date_to}
                onChange={(e) => set("date_to", e.target.value)}
              />
            </div>
          </Field>
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
