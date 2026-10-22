"use client";

import { DatePicker } from "@/components/date-picker";
import { Label } from "@/components/ui/label";

/**
 * "Completed on" TRAVADO das etapas com gatilho (LOCKED_COMPLETED_ON_STEPS em
 * lib/checklist-completion): a data vem do gatilho da etapa e é a da ÚLTIMA
 * atualização do dado dela. Imutável desde 22/10/2026 — ninguém corrige à mão,
 * nem o admin (o antigo "Correct" saiu).
 */
export function LockedCompletedOn({ value }: { value: string | null }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">Completed on</Label>
      <DatePicker
        value={value}
        disabled
        placeholder="Set automatically"
        onChange={() => {}}
        className="mt-1 bg-white"
      />
    </div>
  );
}
