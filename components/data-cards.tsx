"use client";

import { flexRender, type Cell, type Row } from "@tanstack/react-table";

import { cn } from "@/lib/utils";

export type ColumnLabels = Record<string, string>;

/**
 * A partir de qual largura a tabela substitui os cards. A tela precisa casar
 * este valor com o `hidden <bp>:block` da própria <Table>.
 * - `lg` (default, 1024px): corte padrão — a sidebar come 256px na faixa tablet.
 * - `720`: cards só no mobile real; de 720px pra cima já mostra a tabela.
 */
export type DataCardsBreakpoint = "lg" | "720";

/** Classe que esconde os cards quando a tabela assume. Strings literais pra o
 *  scanner do Tailwind gerar ambas as variantes. */
const CARDS_HIDDEN_AT: Record<DataCardsBreakpoint, string> = {
  lg: "lg:hidden",
  "720": "min-[720px]:hidden",
};

/**
 * Versão em cards das listas — a tabela some abaixo do breakpoint e cada linha
 * vira um card empilhado, com rolagem vertical em vez da horizontal. Reaproveita
 * as mesmas colunas do TanStack (inclusive `columnVisibility`), então o que o
 * usuário escolhe no menu "Columns" vale nos dois formatos.
 */
export function DataCards<T>({
  rows,
  labels,
  titleColumnId,
  headerColumnIds = ["actions"],
  emptyMessage,
  onRowClick,
  className,
  breakpoint = "lg",
}: {
  rows: Row<T>[];
  /** Rótulos por coluna — necessário quando o header é componente (SortableHeader). */
  labels?: ColumnLabels;
  /** Coluna que vira o título do card. Default: a primeira visível. */
  titleColumnId?: string;
  /** Colunas fixadas no topo do card, à direita (status, ações…). */
  headerColumnIds?: string[];
  emptyMessage: string;
  onRowClick?: (row: Row<T>) => void;
  className?: string;
  /** Onde a tabela assume o lugar dos cards. Default `lg` — ver DataCardsBreakpoint. */
  breakpoint?: DataCardsBreakpoint;
}) {
  const hiddenAt = CARDS_HIDDEN_AT[breakpoint];

  if (rows.length === 0) {
    return (
      <p
        className={cn(
          "rounded-2xl border bg-white px-4 py-8 text-center text-sm text-muted-foreground",
          hiddenAt,
          className
        )}
      >
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className={cn("grid gap-3", hiddenAt, className)}>
      {rows.map((row) => {
        const cells = row.getVisibleCells();
        const title =
          cells.find((c) => c.column.id === titleColumnId) ??
          cells.find((c) => !headerColumnIds.includes(c.column.id));
        const header = cells.filter((c) => headerColumnIds.includes(c.column.id));
        const fields = cells.filter((c) => c !== title && !header.includes(c));
        const clickable = !!onRowClick;

        return (
          <div
            key={row.id}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? () => onRowClick(row) : undefined}
            onKeyDown={
              clickable
                ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onRowClick(row);
                    }
                  }
                : undefined
            }
            className={cn(
              "rounded-2xl border bg-white p-4 text-sm",
              clickable && "cursor-pointer transition-colors hover:bg-slate-50/60"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {title && (
                  <>
                    <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
                      {cellLabel(title, labels)}
                    </p>
                    <div className="font-medium break-words text-slate-800">
                      {flexRender(title.column.columnDef.cell, title.getContext())}
                    </div>
                  </>
                )}
              </div>
              {header.length > 0 && (
                <div className="flex shrink-0 items-center gap-2">
                  {header.map((cell) => (
                    <div key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {fields.length > 0 && (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-3">
                {fields.map((cell) => (
                  <div key={cell.id} className="min-w-0">
                    <dt className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
                      {cellLabel(cell, labels)}
                    </dt>
                    <dd className="mt-0.5 break-words text-slate-700">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Deriva o rótulo do campo: mapa explícito → header em texto → `cardLabel` que o
 * `sortableHeader` pendura no componente → id da coluna.
 */
function cellLabel<T>(cell: Cell<T, unknown>, labels?: ColumnLabels): string {
  const fromMap = labels?.[cell.column.id];
  if (fromMap) return fromMap;
  const header = cell.column.columnDef.header;
  if (typeof header === "string" && header) return header;
  if (typeof header === "function") {
    const { cardLabel } = header as { cardLabel?: string };
    if (cardLabel) return cardLabel;
  }
  return cell.column.id.replace(/_/g, " ");
}

/**
 * Célula das listas escritas à mão (telas de detalhe): abaixo de `lg` a linha
 * vira card empilhado, então o rótulo do cabeçalho passa a acompanhar o valor.
 */
export function RowField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase lg:hidden">
        {label}
      </p>
      <div className="mt-0.5 lg:mt-0">{children}</div>
    </div>
  );
}

/** Converte as opções do menu "Columns" no mapa de rótulos dos cards. */
export function labelsFromOptions(options: { id: string; label: string }[]): ColumnLabels {
  return Object.fromEntries(options.map((o) => [o.id, o.label]));
}
