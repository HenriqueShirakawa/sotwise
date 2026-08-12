"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import type { OrderInput } from "@/domain/orders/schema";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchSelect } from "@/components/search-select";

import { createOrder, updateOrder } from "./actions";
import type { OrderRow, Ref } from "./orders-client";

type FormState = {
  order_type_id: string;
  schedule_requested: string;
  client_id: string;
  client_reference: string;
  business_unit_id: string;
  requester_id: string;
  exporter_id: string;
  leader_id: string;
};

const EMPTY: FormState = {
  order_type_id: "",
  schedule_requested: "",
  client_id: "",
  client_reference: "",
  business_unit_id: "",
  requester_id: "",
  exporter_id: "",
  leader_id: "",
};

function fromRow(row: OrderRow): FormState {
  return {
    order_type_id: row.order_type_id ?? "",
    schedule_requested: row.schedule_requested ?? "",
    client_id: row.client_id ?? "",
    client_reference: row.client_reference ?? "",
    business_unit_id: row.business_unit_id ?? "",
    requester_id: row.requester_id ?? "",
    exporter_id: row.exporter_id ?? "",
    leader_id: row.leader_id ?? "",
  };
}

export function OrderFormModal({
  open,
  onOpenChange,
  editing,
  nextPo,
  orderTypes,
  clients,
  businessUnits,
  exporters,
  profiles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: OrderRow | null;
  nextPo: string;
  orderTypes: Ref[];
  clients: Ref[];
  businessUnits: Ref[];
  exporters: Ref[];
  profiles: Ref[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(EMPTY);

  // Reinicializa os campos a cada abertura (novo = vazio; edição = valores
  // atuais). Ajuste de estado durante o render — evita o antipadrão
  // useEffect+setState e já reseta ao reabrir depois de um Cancel.
  const openFor = open ? editing?.id ?? "new" : null;
  const [syncedFor, setSyncedFor] = useState<string | null>(null);
  if (openFor !== syncedFor) {
    setSyncedFor(openFor);
    if (openFor !== null) setForm(editing ? fromRow(editing) : EMPTY);
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const poNumber = editing ? editing.po_number : nextPo;
  // Campos "importantes" que liberam o submit (espelha o botão travado do Bubble).
  const canSubmit =
    !!form.order_type_id && !!form.client_id && !!form.business_unit_id && !pending;

  function submit() {
    const payload: OrderInput = {
      po_number: poNumber,
      order_type_id: form.order_type_id || null,
      schedule_requested: form.schedule_requested || null,
      client_id: form.client_id || null,
      client_reference: form.client_reference.trim() || null,
      business_unit_id: form.business_unit_id || null,
      requester_id: form.requester_id || null,
      exporter_id: form.exporter_id || null,
      leader_id: form.leader_id || null,
    };
    startTransition(async () => {
      if (editing) {
        const res = await updateOrder(editing.id, payload);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Order updated.");
        onOpenChange(false);
        router.refresh();
        return;
      }
      const res = await createOrder(payload);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Order created.");
      onOpenChange(false);
      // Pedido novo abre direto no próprio checklist — a lista atrás do modal
      // é idêntica e voltar pra ela dava a impressão de que nada aconteceu.
      router.push(`/orders/${res.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg text-primary">
            {editing ? "Edit order" : "Create order"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <Section title="Main information">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Order Number">
                <Input value={poNumber} disabled className="bg-muted" />
              </Field>
              <SelectField
                label="Order Type"
                placeholder="Select order type"
                value={form.order_type_id}
                onChange={(v) => set("order_type_id", v)}
                options={orderTypes}
                required
              />
            </div>
            <Field label="Schedule Requested">
              <DatePicker
                value={form.schedule_requested}
                onChange={(v) => set("schedule_requested", v ?? "")}
              />
            </Field>
          </Section>

          <Section title="Customer information">
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Client"
                placeholder="Select client"
                value={form.client_id}
                onChange={(v) => set("client_id", v)}
                options={clients}
                required
              />
              <Field label="Client Reference">
                <Input
                  value={form.client_reference}
                  onChange={(e) => set("client_reference", e.target.value)}
                  placeholder="Enter client reference"
                />
              </Field>
            </div>
            <SelectField
              label="Business Unit"
              placeholder="Select business unit"
              value={form.business_unit_id}
              onChange={(v) => set("business_unit_id", v)}
              options={businessUnits}
              required
            />
          </Section>

          <Section title="Responsible">
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Requester"
                placeholder="Select requester"
                value={form.requester_id}
                onChange={(v) => set("requester_id", v)}
                options={profiles}
              />
              <SelectField
                label="Exporter"
                placeholder="Select exporter"
                value={form.exporter_id}
                onChange={(v) => set("exporter_id", v)}
                options={exporters}
              />
            </div>
            <SelectField
              label="Leader's Order"
              placeholder="Select leader"
              value={form.leader_id}
              onChange={(v) => set("leader_id", v)}
              options={profiles}
            />
          </Section>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="sm:min-w-32"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button className="sm:min-w-32" onClick={submit} disabled={!canSubmit}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            {editing ? "Edit" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <p className="border-b pb-2 text-sm text-muted-foreground">{title}</p>
      {children}
    </section>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-foreground" required={required}>
        {label}
      </Label>
      {children}
    </div>
  );
}

/**
 * Acima deste tamanho o Select vira SearchSelect (com busca por texto). Client
 * tem ~114 registros e rolar a lista inteira à mão era inviável; listas curtas
 * (Order Type, Business Unit) continuam no Select simples, que é mais leve.
 */
const SEARCHABLE_FROM = 10;

function SelectField({
  label,
  placeholder,
  value,
  onChange,
  options,
  required,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  options: Ref[];
  required?: boolean;
}) {
  if (options.length > SEARCHABLE_FROM) {
    return (
      <Field label={label} required={required}>
        <SearchSelect
          value={value}
          onChange={onChange}
          options={options}
          placeholder={placeholder}
        />
      </Field>
    );
  }

  return (
    <Field label={label} required={required}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
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
    </Field>
  );
}
