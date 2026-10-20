"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { todayIso } from "@/lib/format";
import { DatePicker } from "@/components/date-picker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * "Completed on" TRAVADO das etapas com gatilho no PL/Shipment (20/10/2026,
 * LOCKED_COMPLETED_ON_STEPS em lib/checklist-completion): a data vem da
 * auto-conclusão. Admin/owner vê "Correct", que abre o popup — data nova (ou
 * vazia, pra reabrir) + motivo obrigatório, que vai pro History da etapa.
 */
export function LockedCompletedOn({
  value,
  canCorrect,
  onCorrect,
}: {
  value: string | null;
  canCorrect: boolean;
  onCorrect: (date: string | null, reason: string) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<string | null>(value);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function openDialog() {
    setDate(value);
    setReason("");
    setOpen(true);
  }

  function save() {
    startTransition(async () => {
      const res = await onCorrect(date, reason.trim());
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Completion date corrected.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <Label className="text-xs text-muted-foreground">Completed on</Label>
        {canCorrect && (
          <button
            type="button"
            className="text-xs font-medium text-primary hover:underline"
            onClick={openDialog}
          >
            Correct
          </button>
        )}
      </div>
      <DatePicker
        value={value}
        disabled
        placeholder="Set automatically"
        onChange={() => {}}
        className="mt-1 bg-white"
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Correct completion date</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This step is completed automatically. Leave the date empty to reopen it.
          </p>
          <div className="space-y-3">
            <div>
              <Label className="text-foreground">Completed on</Label>
              <DatePicker
                value={date}
                onChange={setDate}
                max={todayIso()}
                className="mt-1.5 bg-white"
              />
            </div>
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
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={pending || !reason.trim() || date === value}
              onClick={save}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
