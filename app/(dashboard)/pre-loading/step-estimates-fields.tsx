"use client";

import { STEP_LABELS, type StepEstimate } from "@/lib/checklist";
import type { ChecklistStep } from "@/types/database";
import { DatePicker } from "@/components/date-picker";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/search-select";

type Ref = { id: string; name: string };

/**
 * Bloco "Estimated date + Responsible" por etapa, ambos obrigatórios — uma
 * linha por etapa. Usado no Confirm Shipping (etapas do Shipment) e no Create
 * pre-loading (etapas do Pre-loading): o que o usuário informa aqui já aparece
 * preenchido no checklist. Abaixo de sm cada etapa empilha os campos.
 */
export function StepEstimatesFields<S extends ChecklistStep>({
  title,
  steps,
  estimates,
  onChange,
  profiles,
}: {
  /** Omitido quando quem usa já põe o título (seção do modal de criação). */
  title?: string;
  steps: readonly S[];
  estimates: Record<S, StepEstimate>;
  onChange: (step: S, patch: Partial<StepEstimate>) => void;
  profiles: Ref[];
}) {
  return (
    <div>
      {title && <p className="mb-2 text-sm font-medium text-slate-800">{title}</p>}
      <div className="hidden gap-3 text-xs text-muted-foreground sm:grid sm:grid-cols-[9rem_1fr_1fr]">
        <span>Step</span>
        <span>
          Estimated date <span className="text-rose-500">*</span>
        </span>
        <span>
          Responsible <span className="text-rose-500">*</span>
        </span>
      </div>
      <div className="mt-2 space-y-3">
        {steps.map((step) => (
          <div
            key={step}
            className="grid gap-2 sm:grid-cols-[9rem_1fr_1fr] sm:items-center sm:gap-3"
          >
            <p className="text-sm text-slate-700">{STEP_LABELS[step]}</p>
            <div>
              <Label className="text-xs text-muted-foreground sm:sr-only">
                Estimated date <span className="text-rose-500">*</span>
              </Label>
              <DatePicker
                value={estimates[step].estimated_date}
                ariaLabel={`${STEP_LABELS[step]} estimated date`}
                onChange={(v) => onChange(step, { estimated_date: v ?? "" })}
                className="mt-1 bg-white sm:mt-0"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground sm:sr-only">
                Responsible <span className="text-rose-500">*</span>
              </Label>
              <div className="mt-1 sm:mt-0">
                <SearchSelect
                  value={estimates[step].responsible_id}
                  onChange={(v) => onChange(step, { responsible_id: v })}
                  options={profiles}
                  placeholder="Select responsible"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Estado inicial do bloco: tudo vazio, ou o que já estiver gravado. */
export function initialStepEstimates<S extends ChecklistStep>(
  steps: readonly S[],
  saved: Partial<Record<S, { estimated_date: string | null; responsible_id: string | null }>> = {}
): Record<S, StepEstimate> {
  return Object.fromEntries(
    steps.map((step) => [
      step,
      {
        estimated_date: saved[step]?.estimated_date ?? "",
        responsible_id: saved[step]?.responsible_id ?? "",
      },
    ])
  ) as Record<S, StepEstimate>;
}

/** Todas as etapas com Estimated date e Responsible? */
export function stepEstimatesFilled<S extends ChecklistStep>(
  steps: readonly S[],
  estimates: Record<S, StepEstimate>
): boolean {
  return steps.every((step) => estimates[step].estimated_date && estimates[step].responsible_id);
}
