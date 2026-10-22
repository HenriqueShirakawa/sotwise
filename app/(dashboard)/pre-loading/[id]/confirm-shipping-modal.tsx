"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { formatDateNumeric } from "@/lib/format";
import {
  CONFIRM_SHIPPING_ESTIMATE_STEPS,
  STEP_LABELS,
  type ShipmentEstimates,
} from "@/lib/checklist";
import type { ChecklistStep } from "@/types/database";
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

import { confirmShipping } from "./actions";
import type { Ref } from "./pl-checklist-client";

/** Uma entrada Factory×Category exibida na tabela do modal (uma linha por OFC). */
export type ShipmentLine = {
  id: string; // order_factory_category.id
  batch_id: string;
  factory: string;
  category: string;
  etd_initial: string | null;
  po_number: string;
  batch_number: string;
  ship_requirement: string | null;
};

/** Chave de ordenação clicável na tabela do modal: fábrica ou nº do PO. */
type SortKey = "factory" | "po";

/** Cabeçalho clicável — a coluna prioritária fica roxa, a outra fica neutra. */
function SortHeaderButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={active ? "Ordenação prioritária" : "Clique para tornar esta coluna prioritária"}
      className={cn(
        "-mx-2 -my-1 rounded-md px-2 py-1 font-medium transition-colors",
        active ? "bg-primary text-primary-foreground" : "hover:bg-slate-200"
      )}
    >
      {label}
    </button>
  );
}

/** Só campo obrigatório vazio bloqueia o Confirm. */
function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input value={value} readOnly disabled className="mt-1 bg-slate-100" />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  options: Ref[];
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1">
        <SearchSelect value={value} onChange={onChange} options={options} placeholder={placeholder} />
      </div>
    </div>
  );
}

/**
 * Modal de "Confirm Shipping" — converte o PL num Shipment. Montado só quando
 * aberto (estado reseta a cada abertura). Desde 13/10/2026 (confirmado com o
 * Gustavo, do GSS) a tabela só lista as Factory × Category dos lotes que o GSS
 * amarrou neste PL — sem o status None/Partial/Total por linha (quem sabe o que
 * embarcou é o GSS, no nível produto) e sem split: nenhum lote é criado.
 */
export function ConfirmShippingModal({
  onClose,
  preLoadingId,
  plNumber,
  clientReference,
  sealNumber,
  loadingDateEstimated,
  loadingDateCompletedOn,
  preloadingLeaderId,
  currentUserId,
  profiles,
  carriers,
  shipmentModels,
  lines,
  shipmentEstimates,
}: {
  onClose: () => void;
  preLoadingId: string;
  plNumber: string;
  clientReference: string | null;
  sealNumber: string | null;
  /** Estimated date da etapa "loading_date" do checklist — só espelha aqui,
   *  quem edita é o checklist (ver confirm-shipping-modal em regras_de_negocio). */
  loadingDateEstimated: string | null;
  /** Completed on da mesma etapa — este popup passa a poder revisar/ajustar. */
  loadingDateCompletedOn: string | null;
  preloadingLeaderId: string | null;
  currentUserId: string;
  profiles: Ref[];
  carriers: Ref[];
  shipmentModels: Ref[];
  lines: ShipmentLine[];
  /** Estimated date já gravada nas etapas do Shipment (ponto de partida). */
  shipmentEstimates: Partial<Record<ChecklistStep, string | null>>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [containerNumber, setContainerNumber] = useState("");
  const [seal, setSeal] = useState(sealNumber ?? "");
  const [loadingDate, setLoadingDate] = useState(loadingDateCompletedOn ?? "");
  const [shipmentLeaderId, setShipmentLeaderId] = useState("");
  const [preLoadingLeaderId, setPreLoadingLeaderId] = useState(preloadingLeaderId ?? "");
  const [carrierId, setCarrierId] = useState("");
  const [shipmentModelId, setShipmentModelId] = useState("");
  const [signerId, setSignerId] = useState(currentUserId);
  // Estimated date de cada etapa do Shipment — obrigatórias (22/10/2026).
  const [estimates, setEstimates] = useState<ShipmentEstimates>(
    () =>
      Object.fromEntries(
        CONFIRM_SHIPPING_ESTIMATE_STEPS.map((step) => [step, shipmentEstimates[step] ?? ""])
      ) as ShipmentEstimates
  );
  // Só uma coluna é prioritária por vez; a outra entra como critério de desempate.
  const [primarySort, setPrimarySort] = useState<SortKey>("factory");

  const sortedLines = useMemo(() => {
    const byFactory = (a: ShipmentLine, b: ShipmentLine) =>
      a.factory.localeCompare(b.factory, undefined, { numeric: true });
    const byPo = (a: ShipmentLine, b: ShipmentLine) =>
      (Number(a.po_number) || 0) - (Number(b.po_number) || 0);
    const [first, second] = primarySort === "factory" ? [byFactory, byPo] : [byPo, byFactory];
    return [...lines].sort((a, b) => first(a, b) || second(a, b));
  }, [lines, primarySort]);

  const headerFilled =
    containerNumber.trim() &&
    seal.trim() &&
    loadingDateEstimated &&
    loadingDate &&
    shipmentLeaderId &&
    preLoadingLeaderId &&
    carrierId &&
    shipmentModelId &&
    signerId &&
    CONFIRM_SHIPPING_ESTIMATE_STEPS.every((step) => estimates[step]);
  const canConfirm = Boolean(headerFilled && lines.length > 0);

  function confirm() {
    startTransition(async () => {
      const res = await confirmShipping(preLoadingId, {
        container_number: containerNumber,
        seal_number: seal,
        estimated_date: loadingDateEstimated ?? "",
        loading_date_completed_on: loadingDate,
        shipment_leader_id: shipmentLeaderId,
        preloading_leader_id: preLoadingLeaderId,
        carrier_id: carrierId,
        shipment_model_id: shipmentModelId,
        signer_id: signerId,
        shipment_estimates: estimates,
      });
      if (res.ok) {
        toast.success(`Shipment created for PL - ${plNumber}.`);
        onClose();
        router.push("/pre-loading");
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-primary">Create New Shipment</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="text-xs text-muted-foreground">
              Container Number <span className="text-rose-500">*</span>
            </Label>
            <Input
              value={containerNumber}
              onChange={(e) => setContainerNumber(e.target.value)}
              placeholder="Container Number"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">
              Seal No: <span className="text-rose-500">*</span>
            </Label>
            <Input
              value={seal}
              onChange={(e) => setSeal(e.target.value)}
              placeholder="Seal Number"
              className="mt-1"
            />
          </div>

          <ReadOnlyField label="PL Number" value={plNumber} />
          <ReadOnlyField label="Client Reference" value={clientReference ?? "—"} />

          <ReadOnlyField label="Status" value="In Transit" />
          <ReadOnlyField
            label="Estimated"
            value={loadingDateEstimated ? formatDateNumeric(loadingDateEstimated) : "—"}
          />

          <SelectField
            label="Leader's Shipment *"
            value={shipmentLeaderId}
            options={profiles}
            onChange={setShipmentLeaderId}
            placeholder="Select leader"
          />
          <SelectField
            label="Leader's Pre-Loading *"
            value={preLoadingLeaderId}
            options={profiles}
            onChange={setPreLoadingLeaderId}
            placeholder="Select leader"
          />

          <SelectField
            label="Carrier *"
            value={carrierId}
            options={carriers}
            onChange={setCarrierId}
            placeholder="Who Carrier"
          />
          <SelectField
            label="Shipment Model *"
            value={shipmentModelId}
            options={shipmentModels}
            onChange={setShipmentModelId}
            placeholder="Model"
          />

          <SelectField
            label="Signer *"
            value={signerId}
            options={profiles}
            onChange={setSignerId}
            placeholder="Select signer"
          />
          <div>
            <Label className="text-xs text-muted-foreground">
              Loading Date <span className="text-rose-500">*</span>
            </Label>
            <DatePicker
              value={loadingDate}
              onChange={(v) => setLoadingDate(v ?? "")}
              className="mt-1 bg-white"
            />
          </div>
        </div>

        {/* Previsões das etapas do Shipment: já aparecem preenchidas nele. */}
        <div>
          <p className="text-sm font-medium text-slate-800">Shipment estimated dates</p>
          <div className="mt-2 grid gap-4 sm:grid-cols-3">
            {CONFIRM_SHIPPING_ESTIMATE_STEPS.map((step) => (
              <div key={step}>
                <Label className="text-xs text-muted-foreground">
                  {STEP_LABELS[step]} <span className="text-rose-500">*</span>
                </Label>
                <DatePicker
                  value={estimates[step]}
                  ariaLabel={`${STEP_LABELS[step]} estimated date`}
                  onChange={(v) => setEstimates((e) => ({ ...e, [step]: v ?? "" }))}
                  className="mt-1 bg-white"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Abaixo de sm cada linha vira card. */}
        <div className="mt-2 divide-y rounded-xl border sm:hidden">
          {sortedLines.map((l) => (
            <div key={l.id} className="space-y-3 px-3 py-3 text-sm">
              <div>
                <p className="font-medium text-slate-800">
                  {l.po_number} / {l.batch_number}
                </p>
                <p className="text-xs text-muted-foreground">
                  {l.factory} · {l.category}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                ETD {l.etd_initial ? formatDateNumeric(l.etd_initial) : "—"}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-2 hidden overflow-x-auto rounded-xl border sm:block">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">
                  <SortHeaderButton
                    label="Factories"
                    active={primarySort === "factory"}
                    onClick={() => setPrimarySort("factory")}
                  />
                </th>
                <th className="px-3 py-2 font-medium">Categories</th>
                <th className="px-3 py-2 font-medium">ETD Initial</th>
                <th className="px-3 py-2 font-medium">
                  <SortHeaderButton
                    label="PO Nº / Batch Nº"
                    active={primarySort === "po"}
                    onClick={() => setPrimarySort("po")}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedLines.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="px-3 py-2">{l.factory}</td>
                  <td className="px-3 py-2">{l.category}</td>
                  <td className="px-3 py-2">
                    {l.etd_initial ? formatDateNumeric(l.etd_initial) : "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {l.po_number} / {l.batch_number}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" className="flex-1" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" disabled={!canConfirm || pending} onClick={confirm}>
            {pending && <Loader2 className="animate-spin" />}
            Confirm Shipping
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
