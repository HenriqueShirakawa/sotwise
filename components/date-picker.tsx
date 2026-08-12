"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { todayIso } from "@/lib/format";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Seletor de data da aplicação — substitui o `<input type="date">` nativo, que
 * obrigava a digitar dd/mm/aaaa campo a campo.
 *
 * O valor entra e sai SEMPRE como "YYYY-MM-DD" (a forma dos campos `date` do
 * Postgres) ou null. Nada de `Date`: converter para objeto de data e voltar é
 * o que costuma trocar o dia por causa de fuso — aqui a conta é feita em cima
 * de ano/mês/dia, sem passar por UTC em momento nenhum.
 */

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

type Parts = { year: number; month: number; day: number };

/** "2026-08-12" → {2026, 8, 12}. Qualquer outra coisa vira null. */
function parseIso(value: string | null | undefined): Parts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const parts = { year: +match[1], month: +match[2], day: +match[3] };
  if (parts.month < 1 || parts.month > 12) return null;
  if (parts.day < 1 || parts.day > daysInMonth(parts.year, parts.month)) return null;
  return parts;
}

function toIso({ year, month, day }: Parts): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Em que coluna o dia 1 cai, com a semana começando na segunda (0 = segunda). */
function firstColumn(year: number, month: number): number {
  return (new Date(year, month - 1, 1).getDay() + 6) % 7;
}

/** Soma dias a uma data, atravessando mês e ano. */
function addDays(parts: Parts, amount: number): Parts {
  const d = new Date(parts.year, parts.month - 1, parts.day + amount);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

/** Mantém o dia dentro do mês de destino (31/03 − 1 mês = 28/02, não 03/03). */
function addMonths(parts: Parts, amount: number): Parts {
  const total = parts.year * 12 + (parts.month - 1) + amount;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return { year, month, day: Math.min(parts.day, daysInMonth(year, month)) };
}

export function DatePicker({
  value,
  onChange,
  disabled = false,
  placeholder = "dd/mm/yyyy",
  className,
  id,
  ariaLabel,
}: {
  /** "YYYY-MM-DD" ou null/"" quando vazio. */
  value: string | null | undefined;
  /** Recebe "YYYY-MM-DD", ou null quando o usuário limpa o campo. */
  onChange: (value: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseIso(value);
  const today = parseIso(todayIso())!;

  // Dia que recebe o foco do teclado — começa no selecionado (ou hoje) e anda
  // com as setas, arrastando o mês visível junto.
  const [cursor, setCursor] = useState<Parts>(selected ?? today);
  const [pickingMonth, setPickingMonth] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  // Reabrir volta pro mês do valor atual — inclusive quando ele mudou por fora.
  // Ajuste de estado durante o render (mesmo padrão dos modais do repo): num
  // efeito isso custaria um render a mais com o mês errado na tela.
  const syncKey = open ? (value ?? "") : null;
  const [syncedKey, setSyncedKey] = useState<string | null>(null);
  if (syncKey !== syncedKey) {
    setSyncedKey(syncKey);
    if (syncKey !== null) {
      setCursor(selected ?? today);
      setPickingMonth(false);
    }
  }

  function commit(parts: Parts) {
    onChange(toIso(parts));
    setOpen(false);
  }

  function onGridKeyDown(e: React.KeyboardEvent) {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (e.key in moves) {
      e.preventDefault();
      setCursor((c) => addDays(c, moves[e.key]));
      return;
    }
    if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      setCursor((c) => addMonths(c, e.key === "PageUp" ? -1 : 1));
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      commit(cursor);
    }
  }

  function focusCursor() {
    gridRef.current?.querySelector<HTMLButtonElement>('[data-cursor="true"]')?.focus();
  }

  // Move o foco do DOM junto com o cursor, senão as setas param de responder
  // depois que o mês vira (o botão focado deixa de existir).
  useEffect(() => {
    if (!open || pickingMonth) return;
    focusCursor();
  }, [open, pickingMonth, cursor.year, cursor.month, cursor.day]);

  const total = daysInMonth(cursor.year, cursor.month);
  const lead = firstColumn(cursor.year, cursor.month);
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];

  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn(
            "flex h-8 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 py-1 text-left text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm",
            className
          )}
        >
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? toDisplay(selected) : placeholder}
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="w-auto p-0"
        align="start"
        // O foco padrão do Popover cai no primeiro botão (o chevron "‹"); aqui
        // ele vai direto pro dia do cursor, que é o que as setas movem.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          focusCursor();
        }}
      >
        <div className="flex items-center justify-between border-b px-2 py-2">
          <NavButton
            label="Previous"
            onClick={() =>
              setCursor((c) =>
                pickingMonth ? { ...c, year: c.year - 1 } : addMonths(c, -1)
              )
            }
          >
            <ChevronLeft className="size-4" />
          </NavButton>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-sm font-semibold text-slate-800 hover:bg-accent"
            onClick={() => setPickingMonth((v) => !v)}
          >
            {pickingMonth ? cursor.year : `${MONTHS[cursor.month - 1]} ${cursor.year}`}
          </button>
          <NavButton
            label="Next"
            onClick={() =>
              setCursor((c) =>
                pickingMonth ? { ...c, year: c.year + 1 } : addMonths(c, 1)
              )
            }
          >
            <ChevronRight className="size-4" />
          </NavButton>
        </div>

        {pickingMonth ? (
          <div className="grid grid-cols-3 gap-1 p-2">
            {MONTHS.map((name, i) => (
              <button
                key={name}
                type="button"
                className={cn(
                  "rounded-md px-2 py-2 text-sm hover:bg-accent",
                  i + 1 === cursor.month && "bg-accent font-medium text-accent-foreground"
                )}
                onClick={() => {
                  setCursor((c) => ({
                    ...c,
                    month: i + 1,
                    day: Math.min(c.day, daysInMonth(c.year, i + 1)),
                  }));
                  setPickingMonth(false);
                }}
              >
                {name.slice(0, 3)}
              </button>
            ))}
          </div>
        ) : (
          <div className="p-2">
            <div className="grid grid-cols-7 gap-0.5">
              {WEEKDAYS.map((w) => (
                <span
                  key={w}
                  className="flex size-9 items-center justify-center text-xs font-medium text-muted-foreground"
                >
                  {w}
                </span>
              ))}
            </div>
            {/* Sem role="grid": os dias já são botões com rótulo próprio, e um
                grid sem row/gridcell de verdade só atrapalharia o leitor de
                tela. O container existe pra capturar as setas do teclado. */}
            <div ref={gridRef} className="grid grid-cols-7 gap-0.5" onKeyDown={onGridKeyDown}>
              {cells.map((day, i) => {
                if (day == null) return <span key={`pad-${i}`} className="size-9" />;
                const parts = { year: cursor.year, month: cursor.month, day };
                const iso = toIso(parts);
                const isSelected = !!selected && toIso(selected) === iso;
                const isToday = toIso(today) === iso;
                return (
                  <button
                    key={iso}
                    type="button"
                    data-cursor={day === cursor.day}
                    tabIndex={day === cursor.day ? 0 : -1}
                    aria-pressed={isSelected}
                    aria-label={toDisplay(parts)}
                    className={cn(
                      "size-9 rounded-md text-sm outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50",
                      isToday && !isSelected && "font-semibold text-primary",
                      isSelected &&
                        "bg-primary font-medium text-primary-foreground hover:bg-primary"
                    )}
                    onClick={() => commit(parts)}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-t px-2 py-1.5">
          <button
            type="button"
            className="rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-accent"
            onClick={() => commit(today)}
          >
            Today
          </button>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-slate-700 disabled:opacity-40 disabled:hover:bg-transparent"
            disabled={!selected}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            Clear
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function toDisplay({ year, month, day }: Parts): string {
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

function NavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="rounded-md p-1.5 text-slate-500 hover:bg-accent hover:text-slate-700"
    >
      {children}
    </button>
  );
}
