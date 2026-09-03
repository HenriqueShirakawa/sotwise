"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { formatDateNumeric } from "@/lib/format";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

type LoadStatus = "none" | "partial" | "total";

/** Chave de ordenação clicável na tabela do modal: fábrica ou nº do PO. */
type SortKey = "factory" | "po";
/** 0 = fora da ordenação, 1 = ativa (roxo claro), 2 = primária (roxo forte). */
type SortLevel = 0 | 1 | 2;

/**
 * Clicar numa coluna liga/avança sua prioridade: 1º clique acende (claro),
 * 2º clique vira primária (forte) e rebaixa a outra coluna a secundária.
 * Clicar de novo na primária reseta as duas (volta à ordem padrão do servidor).
 */
function toggleSortLevel(
  levels: Record<SortKey, SortLevel>,
  key: SortKey
): Record<SortKey, SortLevel> {
  const other: SortKey = key === "factory" ? "po" : "factory";
  if (levels[key] === 2) return { factory: 0, po: 0 };
  if (levels[key] === 1) return { [key]: 2, [other]: 1 } as Record<SortKey, SortLevel>;
  return { ...levels, [key]: 1 };
}

/** Cabeçalho clicável — fica roxo claro no 1º clique, roxo forte (primária) no 2º. */
function SortHeaderButton({
  label,
  level,
  onClick,
}: {
  label: string;
  level: SortLevel;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={
        level === 2
          ? "Ordenação primária — clique para redefinir"
          : level === 1
            ? "Ordenação ativa — clique para tornar primária"
            : "Clique para ordenar por esta coluna"
      }
      className={cn(
        "-mx-2 -my-1 rounded-md px-2 py-1 font-medium transition-colors",
        level === 2 && "bg-primary text-primary-foreground",
        level === 1 && "bg-primary/15 text-primary",
        level === 0 && "hover:bg-slate-200"
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
 * aberto (estado reseta a cada abertura). O status por linha é None/Partial/Total
 * (docs §3.9.6): Total fica no lote; Partial/None migram pro lote novo do split.
 */
export function ConfirmShippingModal({
  onClose,
  preLoadingId,
  plNumber,
  clientReference,
  sealNumber,
  loadingDate,
  preloadingLeaderId,
  currentUserId,
  profiles,
  carriers,
  shipmentModels,
  lines,
}: {
  onClose: () => void;
  preLoadingId: string;
  plNumber: string;
  clientReference: string | null;
  sealNumber: string | null;
  loadingDate: string | null;
  preloadingLeaderId: string | null;
  currentUserId: string;
  profiles: Ref[];
  carriers: Ref[];
  shipmentModels: Ref[];
  lines: ShipmentLine[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [containerNumber, setContainerNumber] = useState("");
  const [seal, setSeal] = useState(sealNumber ?? "");
  const [estimated, setEstimated] = useState("");
  const [shipmentLeaderId, setShipmentLeaderId] = useState("");
  const [preLoadingLeaderId, setPreLoadingLeaderId] = useState(preloadingLeaderId ?? "");
  const [carrierId, setCarrierId] = useState("");
  const [shipmentModelId, setShipmentModelId] = useState("");
  const [signerId, setSignerId] = useState(currentUserId);
  const [statuses, setStatuses] = useState<Record<string, LoadStatus>>({});
  const [sortLevels, setSortLevels] = useState<Record<SortKey, SortLevel>>({
    factory: 0,
    po: 0,
  });

  const sortedLines = useMemo(() => {
    const active = (Object.keys(sortLevels) as SortKey[])
      .filter((k) => sortLevels[k] > 0)
      .sort((a, b) => sortLevels[b] - sortLevels[a]); // primária (2) antes da ativa (1)
    if (active.length === 0) return lines;
    return [...lines].sort((a, b) => {
      for (const key of active) {
        const cmp =
          key === "factory"
            ? a.factory.localeCompare(b.factory, undefined, { numeric: true })
            : (Number(a.po_number) || 0) - (Number(b.po_number) || 0);
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
  }, [lines, sortLevels]);

  const allLinesSet = lines.length > 0 && lines.every((l) => statuses[l.id]);
  const headerFilled =
    containerNumber.trim() &&
    seal.trim() &&
    estimated &&
    shipmentLeaderId &&
    preLoadingLeaderId &&
    carrierId &&
    shipmentModelId &&
    signerId;
  const canConfirm = Boolean(headerFilled && allLinesSet);

  function confirm() {
    startTransition(async () => {
      const res = await confirmShipping(preLoadingId, {
        container_number: containerNumber,
        seal_number: seal,
        estimated_date: estimated,
        shipment_leader_id: shipmentLeaderId,
        preloading_leader_id: preLoadingLeaderId,
        carrier_id: carrierId,
        shipment_model_id: shipmentModelId,
        signer_id: signerId,
        statuses: lines.map((l) => ({ ofc_id: l.id, status: statuses[l.id] })),
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
          <div>
            <Label className="text-xs text-muted-foreground">
              Estimated <span className="text-rose-500">*</span>
            </Label>
            <DatePicker
              value={estimated}
              onChange={(v) => setEstimated(v ?? "")}
              className="mt-1 bg-white"
            />
          </div>

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
          <ReadOnlyField
            label="Loading Date"
            value={loadingDate ? formatDateNumeric(loadingDate) : "—"}
          />
        </div>

        {/* Abaixo de sm cada linha vira card — a tabela tem 5 colunas + select. */}
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
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  ETD {l.etd_initial ? formatDateNumeric(l.etd_initial) : "—"}
                </span>
                <Select
                  value={statuses[l.id] ?? ""}
                  onValueChange={(v) => setStatuses((s) => ({ ...s, [l.id]: v as LoadStatus }))}
                >
                  <SelectTrigger className="h-9 w-36 bg-white">
                    <SelectValue placeholder="Choose status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="partial">Partial</SelectItem>
                    <SelectItem value="total">Total</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
                    level={sortLevels.factory}
                    onClick={() => setSortLevels((s) => toggleSortLevel(s, "factory"))}
                  />
                </th>
                <th className="px-3 py-2 font-medium">Categories</th>
                <th className="px-3 py-2 font-medium">ETD Initial</th>
                <th className="px-3 py-2 font-medium">
                  <SortHeaderButton
                    label="PO Nº / Batch Nº"
                    level={sortLevels.po}
                    onClick={() => setSortLevels((s) => toggleSortLevel(s, "po"))}
                  />
                </th>
                <th className="px-3 py-2 font-medium">Status</th>
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
                  <td className="px-3 py-2">
                    <Select
                      value={statuses[l.id] ?? ""}
                      onValueChange={(v) =>
                        setStatuses((s) => ({ ...s, [l.id]: v as LoadStatus }))
                      }
                    >
                      <SelectTrigger className="h-9 w-36 bg-white">
                        <SelectValue placeholder="Choose status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="partial">Partial</SelectItem>
                        <SelectItem value="total">Total</SelectItem>
                      </SelectContent>
                    </Select>
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
