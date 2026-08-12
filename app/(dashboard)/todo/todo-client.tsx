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
import { Filter, ChevronLeft, ChevronRight, ArrowUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDateNumeric } from "@/lib/format";
import { ORDER_STATUS_LABELS } from "@/lib/status-colors";
import { STEP_LABELS } from "@/lib/checklist";
import type { ChecklistStep, OrderStatus } from "@/types/database";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/status-pill";
import { DataCards, labelsFromOptions } from "@/components/data-cards";
import { ListToolbar } from "@/components/list-toolbar";
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

export type TodoPhase = "order" | "preloading" | "shipment";

export type TodoRow = {
  /** id da etapa do checklist — chave única da linha. */
  id: string;
  /** Fase da esteira — usada pelas abas Order / Preloading / Shipment. */
  phase: TodoPhase;
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
  /** Destino do "Check": /orders, /shipments ou /pre-loading. */
  href: string;
};

/** Abas: "all" = a tabela unificada; as demais filtram por fase (docs §3.12.2). */
const PHASE_TABS: { id: "all" | TodoPhase; label: string }[] = [
  { id: "all", label: "All" },
  { id: "order", label: "Order" },
  { id: "preloading", label: "Preloading" },
  { id: "shipment", label: "Shipment" },
];

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

const CARD_LABELS = labelsFromOptions(COLUMN_OPTIONS);

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
 * de Orders e Pre-loading/Shipment, numa tabela única (no Bubble eram abas de
 * tabelas separadas). As abas aqui só filtram a mesma lista por fase. Read-only:
 * "Check" leva ao checklist correspondente, onde a conclusão de fato acontece.
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
  const [tab, setTab] = useState<"all" | TodoPhase>("all");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<TodoFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([{ id: "date_preview", desc: false }]);
  const { visibility, save: saveVisibility } = useColumnVisibility("todo", initialColumns);

  const filterCount = activeFilterCount(filters);

  const countByPhase = useMemo(() => {
    const m = { all: rows.length, order: 0, preloading: 0, shipment: 0 };
    for (const r of rows) m[r.phase] += 1;
    return m;
  }, [rows]);

  const data = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab !== "all" && r.phase !== tab) return false;
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
  }, [rows, tab, search, filters]);

  const columns = useMemo<ColumnDef<TodoRow>[]>(
    () => [
      {
        id: "po_number",
        accessorFn: (r) => r.po_number ?? "",
        header: ({ column }) => <SortableHeader label="PO Number" column={column} />,
        cell: ({ row }) =>
          row.original.po_number ? (
            <span className="font-medium whitespace-nowrap text-slate-800">
              {row.original.po_number}
            </span>
          ) : (
            dash
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
      {
        id: "actions",
        header: "",
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                router.push(row.original.href);
              }}
            >
              Check
            </Button>
          </div>
        ),
      },
    ],
    [router]
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
  const total = data.length;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">To do list</h1>
          <p className="text-sm text-muted-foreground">
            Track the status of orders and manage upcoming shipping actions by stage and
            responsible party.
          </p>
        </div>
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl border bg-white p-1">
          {PHASE_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                // Step é específico da fase — zera pra não filtrar a aba nova por
                // uma etapa que não existe nela.
                setFilters((f) => ({ ...f, step: "" }));
                table.setPageIndex(0);
              }}
              className={cn(
                "shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
                tab === t.id
                  ? "bg-primary text-primary-foreground"
                  : "text-slate-600 hover:text-slate-800"
              )}
            >
              {t.label}
              <span className={cn("ml-1.5 text-xs", tab === t.id ? "opacity-80" : "text-slate-400")}>
                {countByPhase[t.id]}
              </span>
            </button>
          ))}
        </div>
      </div>

      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="PO or PL number"
        activeCount={filterCount}
        controls={(close) => (
          <Button
            variant="outline"
            className="h-11 rounded-xl bg-white"
            onClick={() => {
              close();
              setFiltersOpen(true);
            }}
          >
            <Filter />
            Filters
            {filterCount > 0 && (
              <span className="ml-1 inline-flex size-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                {filterCount}
              </span>
            )}
          </Button>
        )}
        trailing={() => (
          <ColumnsMenu columns={COLUMN_OPTIONS} visibility={visibility} onSave={saveVisibility} />
        )}
      />

      <FiltersModal
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        filters={filters}
        onApply={setFilters}
        onClear={() => setFilters(EMPTY_FILTERS)}
        clients={clients}
        phase={tab}
      />

      <DataCards
        rows={table.getRowModel().rows}
        labels={CARD_LABELS}
        titleColumnId="step"
        headerColumnIds={["status", "actions"]}
        emptyMessage="You have no pending tasks."
        breakpoint="720"
        onRowClick={(row) => router.push(row.original.href)}
      />

      <div className="hidden overflow-x-auto rounded-2xl border bg-white min-[720px]:block">
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
          Page {pageIndex + 1} of {Math.max(table.getPageCount(), 1)} · Total: {total} records
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
