"use client";

import { useState, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataCards, type DataCardsBreakpoint } from "@/components/data-cards";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Casca das telas de Registration que NÃO são name-only (Contacts, Agents,
 * Business Unit): mesmo cabeçalho, busca, tabela e paginação de 10 do
 * `SimpleRegistrationCrud` — só as colunas e o formulário mudam.
 */
export function RegistrationTable<T>({
  title,
  subtitle,
  createLabel,
  onCreate,
  search,
  onSearchChange,
  searchPlaceholder,
  columns,
  data,
  defaultSorting = [],
  filters,
  cardTitleColumnId,
  cardHeaderColumnIds,
  cardBreakpoint = "lg",
  emptyMessage = "No records found.",
}: {
  title: string;
  subtitle: string;
  createLabel: string;
  onCreate: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  columns: ColumnDef<T>[];
  data: T[];
  defaultSorting?: SortingState;
  /** Controles extras ao lado da busca (ex.: filtro de Location em Agents). */
  filters?: ReactNode;
  /** Coluna que titula o card no mobile. Default: a primeira visível. */
  cardTitleColumnId?: string;
  /** Colunas fixadas no topo do card. Default: só "actions". */
  cardHeaderColumnIds?: string[];
  /** Onde a tabela assume o lugar dos cards. Default `lg` — ver DataCards. */
  cardBreakpoint?: DataCardsBreakpoint;
  emptyMessage?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>(defaultSorting);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
    initialState: { pagination: { pageSize: 10 } },
  });

  const pageIndex = table.getState().pagination.pageIndex;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Button className="h-11 w-full rounded-xl px-5 sm:w-auto" onClick={onCreate}>
          <Plus />
          {createLabel}
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-11 rounded-xl bg-white pl-9"
          />
        </div>
        {filters}
      </div>

      <DataCards
        rows={table.getRowModel().rows}
        titleColumnId={cardTitleColumnId}
        headerColumnIds={cardHeaderColumnIds}
        breakpoint={cardBreakpoint}
        emptyMessage={emptyMessage}
      />

      <div
        className={cn(
          "hidden overflow-x-auto rounded-2xl border bg-white",
          cardBreakpoint === "720" ? "min-[720px]:block" : "lg:block"
        )}
      >
        <Table className="[&_td]:py-3.5 [&_th]:py-3.5">
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="bg-slate-50/80 hover:bg-slate-50/80">
                {hg.headers.map((h) => (
                  <TableHead
                    key={h.id}
                    className="px-4 text-xs font-semibold whitespace-nowrap text-slate-500"
                  >
                    {h.isPlaceholder
                      ? null
                      : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="hover:bg-slate-50/60">
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="px-4 text-sm">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Page {pageIndex + 1} of {Math.max(table.getPageCount(), 1)} · Total: {data.length} records
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="rounded-lg"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Previous page"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="rounded-lg"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label="Next page"
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Cabeçalho clicável de ordenação — uso: `header: sortableHeader("Name")`. */
export function sortableHeader<T>(label: string): ColumnDef<T>["header"] {
  const Header = ({ column }: { column: Column<T, unknown> }) => {
    const sorted = column.getIsSorted();
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1 whitespace-nowrap hover:text-slate-700"
        onClick={column.getToggleSortingHandler()}
      >
        {label}
        <ArrowUpDown className={`size-3.5 ${sorted ? "text-primary" : "text-slate-400"}`} />
      </button>
    );
  };
  // O DataCards precisa do rótulo em texto — o header aqui é componente.
  return Object.assign(Header, { cardLabel: label });
}

/** Botões de editar/excluir da última coluna — idênticos aos do simple-crud. */
export function RowActions({
  onEdit,
  onDelete,
  align = "end",
  containerClassName,
  tooltips = false,
}: {
  onEdit: () => void;
  onDelete: () => void;
  /** Alinhamento dos botões na célula. Default "end" (grudados na borda direita). */
  align?: "start" | "end";
  /** Classes extras no container — ex.: `w-[200px]` para largura fixa da coluna. */
  containerClassName?: string;
  /** Ativa o `title` (tooltip nativo no hover) nos botões. */
  tooltips?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex gap-1",
        align === "start" ? "justify-start" : "justify-end",
        containerClassName
      )}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-slate-500 hover:text-primary"
        aria-label="Edit"
        title={tooltips ? "Edit" : undefined}
        onClick={onEdit}
      >
        <Pencil className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-slate-500 hover:text-destructive"
        aria-label="Delete"
        title={tooltips ? "Delete" : undefined}
        onClick={onDelete}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}
