"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { Search, Filter, ChevronLeft, ChevronRight, ArrowUpDown } from "lucide-react";

import { formatDateNumeric } from "@/lib/format";
import { ORDER_STATUS_LABELS } from "@/lib/status-colors";
import { STEP_LABELS } from "@/lib/checklist";
import type { ChecklistStep, OrderStatus } from "@/types/database";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/status-pill";
import {
  ColumnsMenu,
  useColumnVisibility,
  type ColumnOption,
} from "@/components/columns-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  activeFilterCount,
  EMPTY_FILTERS,
  FiltersModal,
  type Ref,
  type TodoFilters,
} from "./filters-modal";

export type TodoRow = {
  /** id da etapa do checklist — chave única da linha. */
  id: string;
  po_number: string | null;
  pl_number: string | null;
  step: ChecklistStep;
  /** Só nas linhas de Order (etapas de PL não têm status de PO). */
  status: OrderStatus | null;
  responsible: string | null;
  date_preview: string | null;
  client: string | null;
  /** Clientes da linha (Order: 1; PL: N) — usado pelo filtro por Client. */
  client_ids: string[];
  /** Destino do "View": /orders, /shipments ou /pre-loading. */
  href: string;
};

function SortableHeader({
  label,
  column,
}: {
  label: string;
  column: Column<TodoRow, unknown>;
}) {
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
}

const dash = <span className="text-slate-300">—</span>;
const text = (v: string | null) => v || dash;

const COLUMN_OPTIONS: ColumnOption[] = [
  { id: "po_number", label: "PO Number" },
  { id: "pl_number", label: "PL Number" },
  { id: "step", label: "Step" },
  { id: "status", label: "Status PO" },
  { id: "responsible", label: "Responsible" },
  { id: "date_preview", label: "Date preview" },
  { id: "client", label: "Client" },
];

/** Compara datas "YYYY-MM-DD" (mesmo helper das outras listas). */
function inDateRange(value: string | null, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!value) return false;
  const d = value.length >= 10 ? value.slice(0, 10) : value;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

/**
 * To do list (docs §3.12.2) — etapas de checklist pendentes do usuário logado,
 * de Orders e Pre-loading/Shipment. Read-only: clicar na linha leva ao checklist
 * correspondente, onde a conclusão de fato acontece.
 */
export function TodoClient({
  rows,
  clients,
  initialColumns,
}: {
  rows: TodoRow[];
  clients: Ref[];
  initialColumns: VisibilityState;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<TodoFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([{ id: "date_preview", desc: false }]);
  const { visibility, save: saveVisibility } = useColumnVisibility("todo", initialColumns);

  const filterCount = activeFilterCount(filters);

  const data = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filters.client_id && !r.client_ids.includes(filters.client_id)) return false;
      if (filters.status && r.status !== filters.status) return false;
      if (filters.step && r.step !== filters.step) return false;
      if (!inDateRange(r.date_preview, filters.date_from, filters.date_to)) return false;
      if (!q) return true;
      return (
        (r.po_number ?? "").toLowerCase().includes(q) ||
        (r.pl_number ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, filters]);

  const columns = useMemo<ColumnDef<TodoRow>[]>(
    () => [
      {
        id: "po_number",
        accessorFn: (r) => r.po_number ?? "",
        header: ({ column }) => <SortableHeader label="PO Number" column={column} />,
        cell: ({ row }) => (
          <span className="font-medium text-slate-800">{text(row.original.po_number)}</span>
        ),
      },
      {
        id: "pl_number",
        accessorFn: (r) => Number(r.pl_number) || 0,
        header: ({ column }) => <SortableHeader label="PL Number" column={column} />,
        cell: ({ row }) =>
          row.original.pl_number ? (
            <span className="whitespace-nowrap">PL - {row.original.pl_number}</span>
          ) : (
            dash
          ),
      },
      {
        id: "step",
        accessorFn: (r) => STEP_LABELS[r.step],
        header: ({ column }) => <SortableHeader label="Step" column={column} />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{STEP_LABELS[row.original.step]}</span>
        ),
      },
      {
        id: "status",
        accessorFn: (r) => (r.status ? ORDER_STATUS_LABELS[r.status] : ""),
        header: ({ column }) => <SortableHeader label="Status PO" column={column} />,
        cell: ({ row }) =>
          row.original.status ? (
            <StatusPill label={ORDER_STATUS_LABELS[row.original.status]} />
          ) : (
            dash
          ),
      },
      {
        id: "responsible",
        accessorFn: (r) => r.responsible ?? "",
        header: ({ column }) => <SortableHeader label="Responsible" column={column} />,
        cell: ({ row }) => text(row.original.responsible),
      },
      {
        id: "date_preview",
        accessorFn: (r) => r.date_preview ?? "",
        header: ({ column }) => <SortableHeader label="Date preview" column={column} />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-slate-600">
            {row.original.date_preview ? formatDateNumeric(row.original.date_preview) : dash}
          </span>
        ),
      },
      {
        id: "client",
        accessorFn: (r) => r.client ?? "",
        header: ({ column }) => <SortableHeader label="Client" column={column} />,
        cell: ({ row }) => text(row.original.client),
      },
    ],
    []
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    onColumnVisibilityChange: (updater) =>
      saveVisibility(typeof updater === "function" ? updater(visibility) : updater),
    state: { sorting, columnVisibility: visibility },
    initialState: { pagination: { pageSize: 10 } },
  });

  const pageIndex = table.getState().pagination.pageIndex;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="PO or PL number"
            className="h-11 rounded-xl bg-white pl-9"
          />
        </div>
        <Button
          variant="outline"
          className="h-11 rounded-xl bg-white"
          onClick={() => setFiltersOpen(true)}
        >
          <Filter />
          Filters
          {filterCount > 0 && (
            <span className="ml-1 inline-flex size-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
              {filterCount}
            </span>
          )}
        </Button>
        <div className="ml-auto">
          <ColumnsMenu columns={COLUMN_OPTIONS} visibility={visibility} onSave={saveVisibility} />
        </div>
      </div>

      <FiltersModal
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        filters={filters}
        onApply={setFilters}
        onClear={() => setFilters(EMPTY_FILTERS)}
        clients={clients}
      />

      <div className="overflow-x-auto rounded-2xl border bg-white">
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
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-slate-50/60"
                  onClick={() => router.push(row.original.href)}
                >
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
                  You have no pending tasks.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Page {pageIndex + 1} of {Math.max(table.getPageCount(), 1)}
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
