"use client";

import { useState } from "react";
import { ChevronDown, Paperclip, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export type AttachedFile = {
  id: string;
  file_name: string | null;
  file_path: string;
};

/**
 * Bloco "Attached documents" padrão do sistema, usado em todo checklist.
 *
 * O cabeçalho INTEIRO (clipe + texto + contador + seta) é UM botão só que
 * abre/fecha a lista — antes o clipe ficava de fora e clicar no ícone não fazia
 * nada, só o texto abria. Clicar num documento chama `onDownload`, que abre a
 * URL assinada em nova aba (baixa ou exibe, conforme o tipo).
 *
 * `onAttach`/`onRemove` são opcionais: etapas herdadas (ex.: as do PL vistas no
 * Shipment) entram só pra leitura, sem anexar nem excluir. `open`/`onOpenChange`
 * também: quando controlados, o pai abre a lista sozinho após subir um arquivo.
 */
export function AttachedDocuments({
  attachments,
  onDownload,
  onAttach,
  onRemove,
  pending = false,
  open: controlledOpen,
  onOpenChange,
}: {
  attachments: AttachedFile[];
  onDownload: (a: AttachedFile) => void;
  onAttach?: () => void;
  onRemove?: (a: AttachedFile) => void;
  pending?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const hasDocs = attachments.length > 0;

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex items-center gap-2 rounded-md text-xs text-muted-foreground enabled:hover:text-slate-700 disabled:cursor-default"
          disabled={!hasDocs}
          aria-expanded={hasDocs ? open : undefined}
          onClick={() => setOpen(!open)}
        >
          <Paperclip className="size-4 text-slate-400" />
          Attached documents
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
            {attachments.length} docs
          </span>
          {hasDocs && (
            <ChevronDown
              className={`size-3.5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
            />
          )}
        </button>
        {onAttach && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={pending}
            onClick={onAttach}
          >
            <Plus className="size-3.5" />
            Attach
          </Button>
        )}
      </div>
      {open && hasDocs && (
        <div className="mt-2 space-y-1">
          {attachments.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between rounded-md bg-white px-3 py-1.5 text-sm"
            >
              <button
                type="button"
                className="truncate text-primary hover:underline"
                disabled={pending}
                onClick={() => onDownload(a)}
              >
                {a.file_name ?? "File"}
              </button>
              {onRemove && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-rose-500 hover:text-rose-600"
                  aria-label="Delete attachment"
                  disabled={pending}
                  onClick={() => onRemove(a)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
