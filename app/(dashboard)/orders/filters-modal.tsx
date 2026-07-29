"use client";

import { useState } from "react";

import { ORDER_STATUS_LABELS } from "@/lib/status-colors";
import type { OrderStatus } from "@/types/database";
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

import type { Ref } from "./orders-client";

export type OrdersFilters = {
  client_reference: string;
  business_unit_id: string;
  order_type_id: string;
  leader_id: string;
  exporter_id: string;
  status: OrderStatus | "";
  create_date_from: string;
  create_date_to: string;
  etd_from: string;
  etd_to: string;
  schedule_from: string;
  schedule_to: string;
};

export const EMPTY_FILTERS: OrdersFilters = {
  client_reference: "",
  business_unit_id: "",
  order_type_id: "",
  leader_id: "",
  exporter_id: "",
  status: "",
  create_date_from: "",
  create_date_to: "",
  etd_from: "",
  etd_to: "",
  schedule_from: "",
  schedule_to: "",
};

export function activeFilterCount(filters: OrdersFilters): number {
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
  orderTypes,
  businessUnits,
  exporters,
  profiles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: OrdersFilters;
  onApply: (filters: OrdersFilters) => void;
  onClear: () => void;
  orderTypes: Ref[];
  businessUnits: Ref[];
  exporters: Ref[];
  profiles: Ref[];
}) {
  const [draft, setDraft] = useState<OrdersFilters>(filters);

  // Ressincroniza o rascunho com os filtros ativos toda vez que o modal abre.
  const [syncedOpen, setSyncedOpen] = useState(false);
  if (open !== syncedOpen) {
    setSyncedOpen(open);
    if (open) setDraft(filters);
  }

  const set = <K extends keyof OrdersFilters>(key: K, value: OrdersFilters[K]) =>
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
            <Field label="Client Reference">
              <Input
                value={draft.client_reference}
                onChange={(e) => set("client_reference", e.target.value)}
                placeholder="Enter Client Reference"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Business Unit">
                <Select
                  value={draft.business_unit_id || "all"}
                  onValueChange={(v) => set("business_unit_id", v === "all" ? "" : v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose Business Unit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {businessUnits.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Order Type">
                <Select
                  value={draft.order_type_id || "all"}
                  onValueChange={(v) => set("order_type_id", v === "all" ? "" : v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose Order Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {orderTypes.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Leader">
                <SearchSelect
                  value={draft.leader_id}
                  onChange={(v) => set("leader_id", v)}
                  options={profiles}
                  placeholder="Select Leader"
                />
              </Field>
              <Field label="Exporter">
                <SearchSelect
                  value={draft.exporter_id}
                  onChange={(v) => set("exporter_id", v)}
                  options={exporters}
                  placeholder="Select Exporter"
                />
              </Field>
            </div>
          </Section>

          <Section title="Production Details">
            <Field label="Status">
              <Select
                value={draft.status || "all"}
                onValueChange={(v) =>
                  set("status", v === "all" ? "" : (v as OrderStatus))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {(Object.entries(ORDER_STATUS_LABELS) as [OrderStatus, string][]).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </Field>
          </Section>

          <Section title="Date Ranges">
            <DateRangeField
              label="Create Date"
              from={draft.create_date_from}
              to={draft.create_date_to}
              onFromChange={(v) => set("create_date_from", v)}
              onToChange={(v) => set("create_date_to", v)}
            />
            <DateRangeField
              label="ETD"
              from={draft.etd_from}
              to={draft.etd_to}
              onFromChange={(v) => set("etd_from", v)}
              onToChange={(v) => set("etd_to", v)}
            />
            <DateRangeField
              label="Schedule req."
              from={draft.schedule_from}
              to={draft.schedule_to}
              onFromChange={(v) => set("schedule_from", v)}
              onToChange={(v) => set("schedule_to", v)}
            />
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
