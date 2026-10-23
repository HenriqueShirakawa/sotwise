"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { EVENT_DATE_ALLOWS_FUTURE, EVENT_DATE_STEPS } from "@/lib/checklist";
import { formatDateNumeric, todayIso } from "@/lib/format";
import type { ChecklistStep } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/date-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { saveShipmentEventDate } from "./actions";

/**
 * Data do fato de Shipping Date / ETA / ATA / Delivered (21/10/2026), no molde
 * do "Order received date" da Order: o campo mostra a data vigente e abre um
 * popup pra gravar. A 1ª gravação é livre e conclui a etapa; trocar depois exige
 * motivo — o de → para fica no History da etapa.
 *
 * `label` + `onSave` trocam o destino: a Delivered date de UM cliente (PL com
 * 2+ clientes, 22/10/2026) usa o mesmo campo.
 */
export function EventDateField({
  preLoadingId,
  step,
  date,
  label: labelOverride,
  onSave,
}: {
  preLoadingId: string;
  step: ChecklistStep;
  date: string | null;
  label?: string;
  onSave?: (date: string, reason: string | null) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const router = useRouter();
  const label = labelOverride ?? EVENT_DATE_STEPS[step] ?? "Date";
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const reasonRequired = !!date;
  const canSave = !!value && value !== date && (!reasonRequired || reason.trim() !== "");

  function openDialog() {
    setValue(date ?? "");
    setReason("");
    setOpen(true);
  }

  function save() {
    startTransition(async () => {
      const res = onSave
        ? await onSave(value, reason.trim() || null)
        : await saveShipmentEventDate(preLoadingId, step, value, reason.trim() || null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(date ? "Revision saved." : `${label} saved.`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-white px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-sm font-medium text-slate-800">
            {date ? formatDateNumeric(date) : "Not set"}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={openDialog}>
          <Plus className="size-3.5" />
          {date ? "Revise" : "Set date"}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg text-primary">{label}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-foreground">{label}</Label>
              <DatePicker
                value={value || null}
                onChange={(v) => setValue(v ?? "")}
                // ETA e ATA podem ser futuras (22/10/2026); as demais são fato consumado.
                max={EVENT_DATE_ALLOWS_FUTURE.has(step) ? undefined : todayIso()}
                className="mt-1.5 bg-white"
              />
            </div>
            {reasonRequired && (
              <div>
                <Label className="text-foreground">Reason</Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why is this date changing?"
                  className="mt-1.5 bg-white"
                  rows={3}
                />
              </div>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1 bg-white"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="button" className="flex-1" disabled={!canSave || pending} onClick={save}>
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
