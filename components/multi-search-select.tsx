"use client";

import { useState } from "react";
import { Check, Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Seleção MÚLTIPLA com busca — versão multi do `SearchSelect`. Os escolhidos
 * viram chips removíveis no gatilho (igual ao "Choose some clients..." do
 * Bubble). Mantém a ordem de seleção.
 */
export function MultiSearchSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  options: { id: string; name: string }[];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const nameById = new Map(options.map((o) => [o.id, o.name]));
  const filtered = options
    .filter((o) => o.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 50);

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex min-h-20 w-full items-start gap-2 rounded-lg border border-input bg-white px-3 py-2.5 text-left text-sm"
        >
          <Search className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          {value.length === 0 ? (
            <span className="text-muted-foreground">{placeholder}</span>
          ) : (
            <span className="flex flex-wrap gap-1.5">
              {value.map((id) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                >
                  {nameById.get(id) ?? id}
                  <X
                    className="size-3 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange(value.filter((v) => v !== id));
                    }}
                  />
                </span>
              ))}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="border-b p-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            className="h-9"
          />
        </div>
        <div className="max-h-60 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">No results.</p>
          ) : (
            filtered.map((o) => {
              const checked = value.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-100"
                  onClick={() => toggle(o.id)}
                >
                  {/* Caixinha decorativa: o próprio botão da linha é o checkbox.
                      Usar o <Checkbox> aqui aninharia <button> dentro de <button>. */}
                  <span
                    aria-hidden
                    data-checked={checked || undefined}
                    className="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground"
                  >
                    {checked ? <Check className="size-3.5" /> : null}
                  </span>
                  {o.name}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
