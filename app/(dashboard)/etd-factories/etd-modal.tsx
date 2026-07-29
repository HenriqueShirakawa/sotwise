"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getOrderEtdStepData } from "@/app/(dashboard)/orders/[id]/actions";
import { EtdStepTable } from "@/app/(dashboard)/orders/[id]/etd-step";
import type {
  BatchRow,
  EtdInfoRow,
  OfcRow,
  Ref,
} from "@/app/(dashboard)/orders/[id]/order-detail-client";

type EtdStepData = {
  ofc: OfcRow[];
  batches: BatchRow[];
  etdByOfc: Record<string, EtdInfoRow>;
};

/**
 * Abre a MESMA visualização de ETD do Order Checklist (`EtdStepTable`) num modal,
 * carregando os dados do pedido sob demanda. Usado ao clicar numa linha da tela
 * ETD Factories. Após cada edição, recarrega os dados pra refletir na tabela.
 */
export function EtdOrderModal({
  orderId,
  title,
  factories,
  open,
  onOpenChange,
}: {
  orderId: string | null;
  title: string;
  factories: Ref[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [data, setData] = useState<EtdStepData | null>(null);
  const [loading, setLoading] = useState(false);

  // `silent` recarrega sem trocar a tabela por "Loading…" — usado pra reconciliar
  // os dados após uma edição, sem piscar o modal.
  function load(id: string, silent = false) {
    if (!silent) setLoading(true);
    return getOrderEtdStepData(id).then((res) => {
      if (res.ok) setData({ ofc: res.ofc, batches: res.batches, etdByOfc: res.etdByOfc });
      else toast.error(res.error);
      if (!silent) setLoading(false);
    });
  }

  // Carrega os dados toda vez que o modal abre para um pedido diferente.
  const openFor = open ? orderId : null;
  const [syncedFor, setSyncedFor] = useState<string | null>(null);
  if (openFor !== syncedFor) {
    setSyncedFor(openFor);
    setData(null);
    if (openFor) load(openFor);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="text-lg text-primary">ETD</DialogTitle>
          {title && <p className="text-sm text-muted-foreground">{title}</p>}
        </DialogHeader>

        {loading || !data ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <EtdStepTable
            orderId={orderId!}
            ofc={data.ofc}
            batches={data.batches}
            etdByOfc={data.etdByOfc}
            factories={factories}
            onChanged={() => {
              if (orderId) return load(orderId, true);
            }}
          />
        )}

        <DialogFooter>
          <Button variant="outline" className="sm:min-w-32" onClick={() => onOpenChange(false)}>
            Back
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
