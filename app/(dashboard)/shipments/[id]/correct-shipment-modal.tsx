"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { todayIso } from "@/lib/format";
import { BATCH_STATUS_LABELS } from "@/lib/status-colors";
import type { CorrectionBatch, ShipmentCorrectionState } from "@/domain/shipments/correct";
import type { ShipmentHeaderValues } from "@/domain/shipments/correction";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchSelect } from "@/components/search-select";
import { StatusPill } from "@/components/status-pill";
import { notifyStepLogChanged } from "@/components/checklist/step-log-section";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { correctShipment, loadShipmentCorrection } from "./actions";
import type { Ref } from "./shipment-detail-client";

type Loaded = {
  state: ShipmentCorrectionState;
  carriers: Ref[];
  shipmentModels: Ref[];
  addable: CorrectionBatch[];
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">
        {label} <span className="text-rose-500">*</span>
      </Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * "Correct shipment" (19/11/2026) — admin/owner reabre o que o popup do
 * Confirm gravou (mesmos campos) e os lotes do embarque. Motivo obrigatório:
 * a correção inteira vira uma entrada "Correction" no History da etapa Loading
 * Date. Regra em domain/shipments/correction.ts. Montado só quando aberto.
 */
export function CorrectShipmentModal({
  shipmentId,
  profiles,
  onClose,
}: {
  shipmentId: string;
  profiles: Ref[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [header, setHeader] = useState<ShipmentHeaderValues | null>(null);
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [toAdd, setToAdd] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    let alive = true;
    loadShipmentCorrection(shipmentId).then((res) => {
      if (!alive) return;
      if (!res.ok) {
        setLoadError(res.error);
        return;
      }
      setData({
        state: res.state,
        carriers: res.carriers,
        shipmentModels: res.shipmentModels,
        addable: res.addable,
      });
      const h = res.state.header;
      setHeader({
        container_number: h.container_number ?? "",
        seal_number: h.seal_number ?? "",
        loading_date: h.loading_date ?? "",
        shipment_leader_id: h.shipment_leader_id ?? "",
        preloading_leader_id: h.preloading_leader_id ?? "",
        carrier_id: h.carrier_id ?? "",
        shipment_model_id: h.shipment_model_id ?? "",
        signer_id: h.signer_id ?? "",
      });
      setBatchIds(res.state.batches.map((b) => b.id));
    });
    return () => {
      alive = false;
    };
  }, [shipmentId]);

  const set = (field: keyof ShipmentHeaderValues, value: string) =>
    setHeader((h) => (h ? { ...h, [field]: value } : h));

  const batchById = useMemo(() => {
    const map = new Map<string, CorrectionBatch>();
    for (const b of data?.state.batches ?? []) map.set(b.id, b);
    for (const b of data?.addable ?? []) map.set(b.id, b);
    return map;
  }, [data]);

  const delivered = data?.state.status === "delivered";
  const addOptions = useMemo(
    () =>
      (data?.addable ?? [])
        .filter((b) => !batchIds.includes(b.id))
        .map((b) => ({ id: b.id, name: b.client ? `${b.label} · ${b.client}` : b.label })),
    [data, batchIds]
  );

  const originalIds = new Set(data?.state.batches.map((b) => b.id) ?? []);
  const removed = (data?.state.batches ?? []).filter((b) => !batchIds.includes(b.id));
  // Igual ao servidor: o que tinha valor não pode ficar vazio; campo de
  // embarque legado que nunca foi preenchido pode seguir vazio.
  const filled =
    !!header &&
    !!data &&
    (Object.keys(header) as (keyof ShipmentHeaderValues)[]).every(
      (f) => header[f].trim() !== "" || !(data.state.header[f] ?? "").trim()
    ) &&
    batchIds.length > 0;
  const canSave = filled && reason.trim() !== "" && !pending;

  function addBatch(id: string) {
    if (!id) return;
    setBatchIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    setToAdd("");
  }

  function save() {
    if (!header) return;
    startTransition(async () => {
      const res = await correctShipment(shipmentId, { ...header, batch_ids: batchIds, reason });
      if (res.ok) {
        toast.success("Shipment corrected.");
        notifyStepLogChanged();
        onClose();
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-primary">
            Correct shipment{data ? ` · PL - ${data.state.pl_number}` : ""}
          </DialogTitle>
          <DialogDescription>
            Fix what was filled in when the Pre-loading became a Shipment. Every change is saved
            with the reason in the History of the Loading Date step.
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <p className="text-sm text-rose-600">{loadError}</p>
        ) : !data || !header ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Container Number">
                <Input
                  value={header.container_number}
                  onChange={(e) => set("container_number", e.target.value)}
                  placeholder="Container Number"
                />
              </Field>
              <Field label="Seal No:">
                <Input
                  value={header.seal_number}
                  onChange={(e) => set("seal_number", e.target.value)}
                  placeholder="Seal Number"
                />
              </Field>
              <Field label="Loading Date">
                <DatePicker
                  value={header.loading_date}
                  onChange={(v) => set("loading_date", v ?? "")}
                  max={todayIso()}
                  className="bg-white"
                />
              </Field>
              <Field label="Signer">
                <SearchSelect
                  value={header.signer_id}
                  onChange={(v) => set("signer_id", v)}
                  options={profiles}
                  placeholder="Select signer"
                />
              </Field>
              <Field label="Leader's Shipment">
                <SearchSelect
                  value={header.shipment_leader_id}
                  onChange={(v) => set("shipment_leader_id", v)}
                  options={profiles}
                  placeholder="Select leader"
                />
              </Field>
              <Field label="Leader's Pre-Loading">
                <SearchSelect
                  value={header.preloading_leader_id}
                  onChange={(v) => set("preloading_leader_id", v)}
                  options={profiles}
                  placeholder="Select leader"
                />
              </Field>
              <Field label="Carrier">
                <SearchSelect
                  value={header.carrier_id}
                  onChange={(v) => set("carrier_id", v)}
                  options={data.carriers}
                  placeholder="Who Carrier"
                />
              </Field>
              <Field label="Shipment Model">
                <SearchSelect
                  value={header.shipment_model_id}
                  onChange={(v) => set("shipment_model_id", v)}
                  options={data.shipmentModels}
                  placeholder="Model"
                />
              </Field>
            </div>

            <div className="mt-2 rounded-xl border">
              <p className="border-b bg-slate-50/80 px-4 py-2.5 text-sm font-medium text-slate-700">
                Batches in this shipment
              </p>
              <ul className="divide-y">
                {batchIds.map((id) => {
                  const b = batchById.get(id);
                  const isNew = !originalIds.has(id);
                  // Lote entregue não sai; embarque entregue não troca lotes.
                  const locked = delivered || (b ? b.status !== "in_transit" && !isNew : false);
                  return (
                    <li key={id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="font-medium text-slate-800">{b?.label ?? id}</span>
                      <span className="text-muted-foreground">{b?.client ?? "—"}</span>
                      <span className="ml-auto flex items-center gap-2">
                        {isNew ? (
                          <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            Will be added
                          </span>
                        ) : (
                          b && <StatusPill label={BATCH_STATUS_LABELS[b.status]} />
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 text-slate-400 hover:text-rose-600"
                          disabled={locked || batchIds.length === 1}
                          title={
                            locked
                              ? "Delivered batches stay in the shipment."
                              : batchIds.length === 1
                                ? "A shipment needs at least one batch."
                                : "Remove from the shipment"
                          }
                          onClick={() => setBatchIds((ids) => ids.filter((x) => x !== id))}
                        >
                          <X className="size-4" />
                        </Button>
                      </span>
                    </li>
                  );
                })}
                {removed.map((b) => (
                  <li
                    key={b.id}
                    className="flex flex-wrap items-center gap-3 bg-rose-50/40 px-4 py-2.5 text-sm"
                  >
                    <span className="font-medium text-slate-500 line-through">{b.label}</span>
                    <span className="text-muted-foreground">{b.client ?? "—"}</span>
                    <span className="ml-auto flex items-center gap-2">
                      <span className="rounded-md bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
                        Back to In Production
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setBatchIds((ids) => [...ids, b.id])}
                      >
                        Undo
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
              {!delivered && (
                <div className="border-t px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <SearchSelect
                        value={toAdd}
                        onChange={addBatch}
                        options={addOptions}
                        placeholder={
                          addOptions.length ? "Add a batch to this shipment" : "No batch available to add"
                        }
                        disabled={addOptions.length === 0}
                      />
                    </div>
                    <Plus className="size-4 text-slate-400" />
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Only In Production batches, outside any Pre-loading and with quantities already
                    confirmed by the GSS, can be added (same rule as the Confirm).
                  </p>
                </div>
              )}
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">
                Reason for the correction <span className="text-rose-500">*</span>
              </Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="What was wrong and why it is being corrected"
                className="mt-1"
                rows={3}
              />
            </div>
          </>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" className="flex-1" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" disabled={!canSave} onClick={save}>
            {pending && <Loader2 className="animate-spin" />}
            Save correction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
