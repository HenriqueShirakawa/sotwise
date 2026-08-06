"use client";

import { useState } from "react";

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

/** Os 3 status possíveis de `shipments.status` (docs §3.10.1). */
export const STATUS_OPTIONS: Ref[] = [
  { id: "in_transit", name: "In Transit" },
  { id: "delivered", name: "Delivered" },
  { id: "canceled", name: "Canceled" },
];

export type ShipmentFilters = {
  client_id: string;
  status: string;
  leader_id: string;
  order_id: string;
  order_type_id: string;
  agent_brazil_id: string;
  agent_china_id: string;
  carrier_id: string;
  container_number: string;
  consolidation_point_id: string;
  pol_id: string;
  pod_id: string;
  shipment_model_id: string;
  loading_from: string;
  loading_to: string;
  ship_from: string;
  ship_to: string;
  bl_from: string;
  bl_to: string;
  eta_from: string;
  eta_to: string;
  ata_from: string;
  ata_to: string;
  delivered_from: string;
  delivered_to: string;
};

export const EMPTY_FILTERS: ShipmentFilters = {
  client_id: "",
  status: "",
  leader_id: "",
  order_id: "",
  order_type_id: "",
  agent_brazil_id: "",
  agent_china_id: "",
  carrier_id: "",
  container_number: "",
  consolidation_point_id: "",
  pol_id: "",
  pod_id: "",
  shipment_model_id: "",
  loading_from: "",
  loading_to: "",
  ship_from: "",
  ship_to: "",
  bl_from: "",
  bl_to: "",
  eta_from: "",
  eta_to: "",
  ata_from: "",
  ata_to: "",
  delivered_from: "",
  delivered_to: "",
};

export function activeFilterCount(filters: ShipmentFilters): number {
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

/** Par de/até de um range de datas. */
function DateRange({
  label,
  from,
  to,
  onFrom,
  onTo,
}: {
  label: string;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <div className="grid grid-cols-2 gap-3">
        <Input type="date" value={from} onChange={(e) => onFrom(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => onTo(e.target.value)} />
      </div>
    </Field>
  );
}

/**
 * Filtros da lista de Shipments — os 5 grupos de docs §3.10.2. Dois campos aqui
 * não existem como coluna da lista (Container Number e BL Date): só dá pra
 * chegar neles por filtro, e é de propósito.
 */
export function FiltersModal({
  open,
  onOpenChange,
  filters,
  onApply,
  onClear,
  clients,
  profiles,
  orders,
  orderTypes,
  agents,
  carriers,
  pols,
  pods,
  factories,
  shipmentModels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: ShipmentFilters;
  onApply: (filters: ShipmentFilters) => void;
  onClear: () => void;
  clients: Ref[];
  profiles: Ref[];
  orders: Ref[];
  orderTypes: Ref[];
  agents: Ref[];
  carriers: Ref[];
  pols: Ref[];
  pods: Ref[];
  factories: Ref[];
  shipmentModels: Ref[];
}) {
  const [draft, setDraft] = useState<ShipmentFilters>(filters);

  // Ressincroniza o rascunho com os filtros ativos toda vez que o modal abre.
  const [syncedOpen, setSyncedOpen] = useState(false);
  if (open !== syncedOpen) {
    setSyncedOpen(open);
    if (open) setDraft(filters);
  }

  const set = <K extends keyof ShipmentFilters>(key: K, value: ShipmentFilters[K]) =>
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
          <Section title="Basic information">
            <Field label="Client">
              <SearchSelect
                value={draft.client_id}
                onChange={(v) => set("client_id", v)}
                options={clients}
                placeholder="Choose some client"
              />
            </Field>
          </Section>

          <Section title="Business details">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Status Shipment">
                <SearchSelect
                  value={draft.status}
                  onChange={(v) => set("status", v)}
                  options={STATUS_OPTIONS}
                  placeholder="Select a status"
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
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Orders">
                <SearchSelect
                  value={draft.order_id}
                  onChange={(v) => set("order_id", v)}
                  options={orders}
                  placeholder="Type some Orders"
                />
              </Field>
              <Field label="Order Type">
                <SearchSelect
                  value={draft.order_type_id}
                  onChange={(v) => set("order_type_id", v)}
                  options={orderTypes}
                  placeholder="Select an order type"
                />
              </Field>
            </div>
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

          <Section title="Production Details">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Carrier on the shipment">
                <SearchSelect
                  value={draft.carrier_id}
                  onChange={(v) => set("carrier_id", v)}
                  options={carriers}
                  placeholder="Enter carrier name"
                />
              </Field>
              <Field label="Container Number">
                <Input
                  value={draft.container_number}
                  onChange={(e) => set("container_number", e.target.value)}
                  placeholder="Enter container number"
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
            <Field label="Shipment Model">
              <SearchSelect
                value={draft.shipment_model_id}
                onChange={(v) => set("shipment_model_id", v)}
                options={shipmentModels}
                placeholder="Enter shipment model"
              />
            </Field>
          </Section>

          <Section title="Date Ranges">
            <div className="grid gap-4 sm:grid-cols-2">
              <DateRange
                label="Loading Date"
                from={draft.loading_from}
                to={draft.loading_to}
                onFrom={(v) => set("loading_from", v)}
                onTo={(v) => set("loading_to", v)}
              />
              <DateRange
                label="Ship Date"
                from={draft.ship_from}
                to={draft.ship_to}
                onFrom={(v) => set("ship_from", v)}
                onTo={(v) => set("ship_to", v)}
              />
              <DateRange
                label="BL Date"
                from={draft.bl_from}
                to={draft.bl_to}
                onFrom={(v) => set("bl_from", v)}
                onTo={(v) => set("bl_to", v)}
              />
              <DateRange
                label="ETA"
                from={draft.eta_from}
                to={draft.eta_to}
                onFrom={(v) => set("eta_from", v)}
                onTo={(v) => set("eta_to", v)}
              />
              <DateRange
                label="ATA"
                from={draft.ata_from}
                to={draft.ata_to}
                onFrom={(v) => set("ata_from", v)}
                onTo={(v) => set("ata_to", v)}
              />
              <DateRange
                label="Delivered"
                from={draft.delivered_from}
                to={draft.delivered_to}
                onFrom={(v) => set("delivered_from", v)}
                onTo={(v) => set("delivered_to", v)}
              />
            </div>
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
