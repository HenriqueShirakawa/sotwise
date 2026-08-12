"use client";

import { useState } from "react";
import type { VisibilityState } from "@tanstack/react-table";
import { Check, Columns3 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { saveColumnVisibility } from "@/lib/column-prefs-actions";

export type ColumnOption = { id: string; label: string };

/**
 * Visibilidade de colunas de uma lista, guardada NO USUÁRIO (não no navegador):
 * o valor salvo chega do servidor como `initial` (semeado no RSC a partir de
 * `profiles.ui_preferences`, sem flash), e cada mudança é gravada por
 * `listKey` via Server Action. O `useState` só usa `initial` na montagem — as
 * trocas seguintes são do próprio usuário, então persiste otimista e a UI
 * reflete na hora; se o gravar falhar, avisa mas mantém a escolha na sessão.
 */
export function useColumnVisibility(listKey: string, initial: VisibilityState) {
  const [visibility, setVisibility] = useState<VisibilityState>(initial);

  const save = (next: VisibilityState) => {
    setVisibility(next);
    void saveColumnVisibility(listKey, next).then((res) => {
      if (!res.ok) toast.error("Couldn't save your column choice.");
    });
  };

  return { visibility, save };
}

/**
 * Botão "Columns" + popover pra escolher o que aparece na tabela. O rascunho só
 * vale ao clicar em Save; Cancel descarta e fecha.
 */
export function ColumnsMenu({
  columns,
  visibility,
  onSave,
}: {
  columns: ColumnOption[];
  visibility: VisibilityState;
  onSave: (visibility: VisibilityState) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<VisibilityState>(visibility);

  // Ressincroniza o rascunho toda vez que o popover abre.
  const [syncedOpen, setSyncedOpen] = useState(false);
  if (open !== syncedOpen) {
    setSyncedOpen(open);
    if (open) setDraft(visibility);
  }

  const isVisible = (id: string) => draft[id] !== false;
  // Inverte a partir do estado do updater (não do `draft` capturado no render),
  // pra dois cliques seguidos no mesmo tick não se perderem.
  const toggle = (id: string) => setDraft((d) => ({ ...d, [id]: d[id] === false }));

  // Some com todas as colunas quebraria a tabela — pelo menos uma tem de ficar.
  const canSave = columns.some((c) => isVisible(c.id));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-11 rounded-xl bg-white">
          <Columns3 />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <p className="border-b px-4 py-3 text-sm text-muted-foreground">
          Select the columns you want to display in the table.
        </p>
        <div className="max-h-80 space-y-1 overflow-y-auto p-2">
          {columns.map((c) => {
            const visible = isVisible(c.id);
            return (
              <button
                key={c.id}
                type="button"
                role="checkbox"
                aria-checked={visible}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-slate-100"
                onClick={() => toggle(c.id)}
              >
                {/* Caixinha decorativa: o próprio botão da linha é o checkbox.
                    Usar o <Checkbox> aqui aninharia <button> dentro de <button>. */}
                <span
                  aria-hidden
                  data-checked={visible || undefined}
                  className="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground"
                >
                  {visible ? <Check className="size-3.5" /> : null}
                </span>
                {c.label}
              </button>
            );
          })}
        </div>
        <div className="space-y-1 border-t p-3">
          <Button
            className="w-full"
            disabled={!canSave}
            onClick={() => {
              onSave(draft);
              setOpen(false);
            }}
          >
            Save
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
