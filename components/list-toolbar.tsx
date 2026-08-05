"use client";

import { useState, type ReactNode } from "react";
import { EllipsisVertical, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Slot da toolbar: recebe `close` pra fechar o "⋮" ao abrir um modal. */
type Slot = (close: () => void) => ReactNode;

const noop = () => {};

/**
 * Barra de busca + controles das listas. Abaixo de 720px sobra só a busca e um
 * "⋮" que abre os demais filtros num popover — a linha não comporta select,
 * Filters e Columns lado a lado. De 720px pra cima é a barra inteira, como era.
 *
 * Os slots são funções porque os controles são montados nos dois lugares (um
 * escondido por CSS); o `close` só faz efeito na versão de dentro do "⋮".
 */
export function ListToolbar({
  search,
  onSearchChange,
  placeholder,
  controls,
  trailing,
  activeCount = 0,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  placeholder: string;
  /** Controles à esquerda (select de cliente, botão Filters…). */
  controls?: Slot;
  /** Controle encostado na direita no desktop (normalmente o menu Columns). */
  trailing?: Slot;
  /** Nº de filtros ativos — vira o badge do "⋮", pra não esconder estado. */
  activeCount?: number;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const close = () => setMenuOpen(false);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="relative min-w-0 flex-1 min-[720px]:max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={placeholder}
          className="h-11 rounded-xl bg-white pl-9"
        />
      </div>

      {(controls || trailing) && (
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label="More filters"
              className="relative size-11 shrink-0 rounded-xl bg-white min-[720px]:hidden"
            >
              <EllipsisVertical />
              {activeCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 inline-flex size-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                  {activeCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-3">
            <div className="grid gap-2 *:w-full">
              {controls?.(close)}
              {trailing?.(close)}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {controls && (
        <div className="hidden items-center gap-3 min-[720px]:flex">{controls(noop)}</div>
      )}
      {trailing && <div className="ml-auto hidden min-[720px]:block">{trailing(noop)}</div>}
    </div>
  );
}
