"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/date-picker";
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

export type PreLoadingFilters = {
  client_id: string;
  client_reference: string;
  leader_id: string;
  order_id: string;
  agent_brazil_id: string;
  agent_china_id: string;
  carrier_id: string;
  pol_id: string;
  pod_id: string;
  consolidation_point_id: string;
  loading_from: string;
  loading_to: string;
};

export const EMPTY_FILTERS: PreLoadingFilters = {
  client_id: "",
  client_reference: "",
  leader_id: "",
  order_id: "",
  agent_brazil_id: "",
  agent_china_id: "",
  carrier_id: "",
  pol_id: "",
  pod_id: "",
  consolidation_point_id: "",
  loading_from: "",
  loading_to: "",
};

export function activeFilterCount(filters: PreLoadingFilters): number {
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

export function FiltersModal({
  open,
  onOpenChange,
  filters,
  onApply,
  onClear,
  clients,
  profiles,
  orders,
  agents,
  carriers,
  pols,
  pods,
  factories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: PreLoadingFilters;
  onApply: (filters: PreLoadingFilters) => void;
  onClear: () => void;
  clients: Ref[];
  profiles: Ref[];
  orders: Ref[];
  agents: Ref[];
  carriers: Ref[];
  pols: Ref[];
  pods: Ref[];
  factories: Ref[];
}) {
  const [draft, setDraft] = useState<PreLoadingFilters>(filters);

  // Ressincroniza o rascunho com os filtros ativos toda vez que o modal abre.
  const [syncedOpen, setSyncedOpen] = useState(false);
  if (open !== syncedOpen) {
    setSyncedOpen(open);
    if (open) setDraft(filters);
  }

  const set = <K extends keyof PreLoadingFilters>(key: K, value: PreLoadingFilters[K]) =>
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
          <Section title="Customer / Order data">
            <Field label="Client">
              <SearchSelect
                value={draft.client_id}
                onChange={(v) => set("client_id", v)}
                options={clients}
                placeholder="Choose some client"
              />
            </Field>
            <Field label="Client Reference">
              <Input
                value={draft.client_reference}
                onChange={(e) => set("client_reference", e.target.value)}
                placeholder="Enter client reference"
              />
            </Field>
            <Field label="Leader">
              <SearchSelect
                value={draft.leader_id}
                onChange={(v) => set("leader_id", v)}
                options={profiles}
                placeholder="Enter select leader"
              />
            </Field>
            <Field label="Orders">
              <SearchSelect
                value={draft.order_id}
                onChange={(v) => set("order_id", v)}
                options={orders}
                placeholder="Choose Orders"
              />
            </Field>
          </Section>

          <Section title="Involved agents">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Agent Brazil">
                <SearchSelect
                  value={draft.agent_brazil_id}
                  onChange={(v) => set("agent_brazil_id", v)}
                  options={agents}
                  placeholder="Enter agent Brazil"
                />
              </Field>
              <Field label="Agent China">
                <SearchSelect
                  value={draft.agent_china_id}
                  onChange={(v) => set("agent_china_id", v)}
                  options={agents}
                  placeholder="Enter agent China"
                />
              </Field>
            </div>
          </Section>

          <Section title="Transport and logistics">
            <Field label="Carrier">
              <SearchSelect
                value={draft.carrier_id}
                onChange={(v) => set("carrier_id", v)}
                options={carriers}
                placeholder="Enter carrier name"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="POL (Port of Loading)">
                <SearchSelect
                  value={draft.pol_id}
                  onChange={(v) => set("pol_id", v)}
                  options={pols}
                  placeholder="Enter POL"
                />
              </Field>
              <Field label="POD (Port of Discharge)">
                <SearchSelect
                  value={draft.pod_id}
                  onChange={(v) => set("pod_id", v)}
                  options={pods}
                  placeholder="Enter POD"
                />
              </Field>
            </div>
            <Field label="Consolidation Point">
              <SearchSelect
                value={draft.consolidation_point_id}
                onChange={(v) => set("consolidation_point_id", v)}
                options={factories}
                placeholder="Enter consolidation point"
              />
            </Field>
          </Section>

          <Section title="Dates">
            <Field label="Loading Date">
              <div className="grid grid-cols-2 gap-3">
                <DatePicker
                  value={draft.loading_from}
                  onChange={(v) => set("loading_from", v ?? "")}
                  ariaLabel="From"
                />
                <DatePicker
                  value={draft.loading_to}
                  onChange={(v) => set("loading_to", v ?? "")}
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
