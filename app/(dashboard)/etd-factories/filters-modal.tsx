"use client";

import { useState } from "react";

import { BATCH_STATUS_LABELS } from "@/lib/status-colors";
import type { BatchStatus } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/search-select";
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

import type { Ref } from "./etd-factories-client";

/** Único filtro de status desta tela: só existem lotes Pre-Loading/In Production
 * aqui (filtro padrão da listagem — ver docs/regras_de_negocio.md §3.7.4). */
const STATUS_OPTIONS: BatchStatus[] = ["in_production", "preloading"];

export type EtdFactoriesFilters = {
  client_id: string;
  status: BatchStatus | "";
  factory_id: string;
  category_id: string;
  shipment_from: string;
  shipment_to: string;
  initial_from: string;
  initial_to: string;
  current_from: string;
  current_to: string;
  updated_from: string;
  updated_to: string;
  empty_dates: "" | "yes" | "no";
  ready_parts: "" | "yes" | "no";
};

export const EMPTY_FILTERS: EtdFactoriesFilters = {
  client_id: "",
  status: "",
  factory_id: "",
  category_id: "",
  shipment_from: "",
  shipment_to: "",
  initial_from: "",
  initial_to: "",
  current_from: "",
  current_to: "",
  updated_from: "",
  updated_to: "",
  empty_dates: "",
  ready_parts: "",
};

export function activeFilterCount(filters: EtdFactoriesFilters): number {
  return Object.values(filters).filter((v) => v !== "").length;
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

function DateRangeField({
  label,
  from,
  to,
  onFromChange,
  onToChange,
}: {
  label: string;
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <div className="grid grid-cols-2 gap-3">
        <Input type="date" value={from} onChange={(e) => onFromChange(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => onToChange(e.target.value)} />
      </div>
    </Field>
  );
}

export function FiltersModal({
  open,
  onOpenChange,
  filters,
  onApply,
  onClear,
  clients,
  factories,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: EtdFactoriesFilters;
  onApply: (filters: EtdFactoriesFilters) => void;
  onClear: () => void;
  clients: Ref[];
  factories: Ref[];
  categories: Ref[];
}) {
  const [draft, setDraft] = useState<EtdFactoriesFilters>(filters);

  // Ressincroniza o rascunho com os filtros ativos toda vez que o modal abre.
  const [syncedOpen, setSyncedOpen] = useState(false);
  if (open !== syncedOpen) {
    setSyncedOpen(open);
    if (open) setDraft(filters);
  }

  const set = <K extends keyof EtdFactoriesFilters>(key: K, value: EtdFactoriesFilters[K]) =>
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg text-primary">Filters</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <Section title="Basic Information">
            <Field label="Client">
              <SearchSelect
                value={draft.client_id}
                onChange={(v) => set("client_id", v)}
                options={clients}
                placeholder="Choose client..."
              />
            </Field>
          </Section>

          <Section title="Production details">
            <Field label="Status">
              <Select
                value={draft.status || "all"}
                onValueChange={(v) => set("status", v === "all" ? "" : (v as BatchStatus))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {STATUS_OPTIONS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {BATCH_STATUS_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </Section>

          <Section title="Date ranges">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Factory">
                <SearchSelect
                  value={draft.factory_id}
                  onChange={(v) => set("factory_id", v)}
                  options={factories}
                  placeholder="Search for factory..."
                />
              </Field>
              <Field label="Category">
                <SearchSelect
                  value={draft.category_id}
                  onChange={(v) => set("category_id", v)}
                  options={categories}
                  placeholder="Search for category..."
                />
              </Field>
            </div>

            <DateRangeField
              label="Shipment Requirement"
              from={draft.shipment_from}
              to={draft.shipment_to}
              onFromChange={(v) => set("shipment_from", v)}
              onToChange={(v) => set("shipment_to", v)}
            />
            <DateRangeField
              label="Initial Date"
              from={draft.initial_from}
              to={draft.initial_to}
              onFromChange={(v) => set("initial_from", v)}
              onToChange={(v) => set("initial_to", v)}
            />
            <DateRangeField
              label="Current Date"
              from={draft.current_from}
              to={draft.current_to}
              onFromChange={(v) => set("current_from", v)}
              onToChange={(v) => set("current_to", v)}
            />
            <DateRangeField
              label="Last Updated"
              from={draft.updated_from}
              to={draft.updated_to}
              onFromChange={(v) => set("updated_from", v)}
              onToChange={(v) => set("updated_to", v)}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Empty dates">
                <Select
                  value={draft.empty_dates || "all"}
                  onValueChange={(v) =>
                    set("empty_dates", v === "all" ? "" : (v as "yes" | "no"))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose one..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Ready parts">
                <Select
                  value={draft.ready_parts || "all"}
                  onValueChange={(v) =>
                    set("ready_parts", v === "all" ? "" : (v as "yes" | "no"))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose one..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </Section>
        </div>

        <DialogFooter>
          <Button variant="outline" className="sm:min-w-32" onClick={clear}>
            Clear filters
          </Button>
          <Button className="sm:min-w-32" onClick={apply}>
            Apply Filter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
