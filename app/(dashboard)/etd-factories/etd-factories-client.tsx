"use client";

import { useMemo, useState } from "react";
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
import { Filter, Download, ChevronLeft, ChevronRight, ArrowUpDown } from "lucide-react";
import { toast } from "sonner";

import { formatDate, formatDateNumeric } from "@/lib/format";
import { BATCH_STATUS_LABELS } from "@/lib/status-colors";
import type { BatchStatus } from "@/types/database";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusPill } from "@/components/status-pill";
import { DataCards, labelsFromOptions } from "@/components/data-cards";
import { ListToolbar } from "@/components/list-toolbar";
import {
  ColumnsMenu,
  useColumnVisibility,
  type ColumnOption,
} from "@/components/columns-menu";

import {
  activeFilterCount,
  EMPTY_FILTERS,
  FiltersModal,
  type EtdFactoriesFilters,
} from "./filters-modal";
import { EtdOrderModal } from "./etd-modal";

export type Ref = { id: string; name: string };

export type EtdFactoryRow = {
  id: string;
  order_id: string;
  client: string | null;
  client_id: string | null;
  po_number: string;
  batch_number: string;
  factory: string;
  factory_id: string;
  category: string;
  category_id: string;
  order_date: string | null;
  shipment_req: string | null;
  initial_date: string | null;
  current_date: string | null;
  days_delay: number | null;
  last_updated: string | null;
  batch_status: BatchStatus;
  ready_parts: boolean;
  gap_of_ready: number | null;
};

function SortableHeader({
  label,
  column,
}: {
  label: string;
  column: Column<EtdFactoryRow, unknown>;
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
const numOrMin = (v: number | null) => v ?? Number.NEGATIVE_INFINITY;

function toDateOnly(v: string): string {
  return v.length >= 10 ? v.slice(0, 10) : v;
}

/** Compara datas como string (funciona pra "YYYY-MM-DD" e ISO timestamp). */
function inDateRange(value: string | null, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!value) return false;
  const d = toDateOnly(value);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

const COLUMN_OPTIONS: ColumnOption[] = [
  { id: "client", label: "Client" },
  { id: "po_batch", label: "PO . Batches" },
  { id: "factory", label: "Factories" },
  { id: "category", label: "Categories" },
  { id: "order_date", label: "Order date" },
  { id: "shipment_req", label: "Shipment Req." },
  { id: "initial_date", label: "Initial Date" },
  { id: "current_date", label: "Current Date" },
  { id: "days_delay", label: "Days Delay" },
  { id: "last_updated", label: "Last Updated" },
  { id: "batch_status", label: "Status Batches" },
  { id: "ready_parts", label: "Ready Parts" },
  { id: "gap_of_ready", label: "Gap of Ready" },
];

const CARD_LABELS = labelsFromOptions(COLUMN_OPTIONS);

export function EtdFactoriesClient({
  rows,
  clients,
  factories,
  categories,
  initialColumns,
}: {
  rows: EtdFactoryRow[];
  clients: Ref[];
  factories: Ref[];
  categories: Ref[];
  initialColumns: VisibilityState;
}) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<EtdFactoriesFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([{ id: "po_batch", desc: true }]);
  const { visibility, save: saveVisibility } = useColumnVisibility("etd-factories", initialColumns);
  const [modalTarget, setModalTarget] = useState<{
    orderId: string;
    ofcId: string;
    title: string;
  } | null>(null);

  const filterCount = activeFilterCount(filters);

  /** Abre o modal de ETD da linha — usado pela tabela e pelos cards. */
  const openRow = (r: EtdFactoryRow) =>
    setModalTarget({
      orderId: r.order_id,
      ofcId: r.id,
      title: `${r.client ? `${r.client} · ` : ""}PO ${r.po_number} ${r.batch_number} · ${
        r.factory
      } - ${r.category}`,
    });

  const data = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filters.client_id && r.client_id !== filters.client_id) return false;
      if (filters.status && r.batch_status !== filters.status) return false;
      if (filters.factory_id && r.factory_id !== filters.factory_id) return false;
      if (filters.category_id && r.category_id !== filters.category_id) return false;
      if (!inDateRange(r.shipment_req, filters.shipment_from, filters.shipment_to))
        return false;
      if (!inDateRange(r.initial_date, filters.initial_from, filters.initial_to))
        return false;
      if (!inDateRange(r.current_date, filters.current_from, filters.current_to))
        return false;
      if (!inDateRange(r.last_updated, filters.updated_from, filters.updated_to))
        return false;
      if (filters.empty_dates === "yes" && r.initial_date) return false;
      if (filters.empty_dates === "no" && !r.initial_date) return false;
      if (filters.ready_parts === "yes" && !r.ready_parts) return false;
      if (filters.ready_parts === "no" && r.ready_parts) return false;
      if (!q) return true;
      return r.po_number.toLowerCase().includes(q);
    });
  }, [rows, search, filters]);

  const columns = useMemo<ColumnDef<EtdFactoryRow>[]>(
    () => [
      {
        accessorKey: "client",
        header: ({ column }) => <SortableHeader label="Client" column={column} />,
        cell: ({ row }) => (
          <span className="font-medium text-slate-800">{row.original.client ?? dash}</span>
        ),
      },
      {
        id: "po_batch",
        accessorFn: (r) => `${r.po_number} ${r.batch_number}`,
        header: ({ column }) => <SortableHeader label="PO . Batches" column={column} />,
        sortingFn: (a, b) =>
          (Number(a.original.po_number) || 0) - (Number(b.original.po_number) || 0) ||
          a.original.batch_number.localeCompare(b.original.batch_number, undefined, {
            numeric: true,
          }),
        cell: ({ row }) => (
          <span className="font-medium whitespace-nowrap text-slate-800">
            {row.original.po_number} {row.original.batch_number}
          </span>
        ),
      },
      {
        accessorKey: "factory",
        header: ({ column }) => <SortableHeader label="Factories" column={column} />,
      },
      {
        accessorKey: "category",
        header: ({ column }) => <SortableHeader label="Categories" column={column} />,
      },
      {
        accessorKey: "order_date",
        header: ({ column }) => <SortableHeader label="Order date" column={column} />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-slate-600">
            {formatDateNumeric(row.original.order_date)}
          </span>
        ),
      },
      {
        accessorKey: "shipment_req",
        header: ({ column }) => <SortableHeader label="Shipment Req." column={column} />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-slate-600">
            {formatDateNumeric(row.original.shipment_req)}
          </span>
        ),
      },
      {
        accessorKey: "initial_date",
        header: ({ column }) => <SortableHeader label="Initial Date" column={column} />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-slate-600">
            {formatDateNumeric(row.original.initial_date)}
          </span>
        ),
      },
      {
        accessorKey: "current_date",
        header: ({ column }) => <SortableHeader label="Current Date" column={column} />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-slate-600">
            {formatDateNumeric(row.original.current_date)}
          </span>
        ),
      },
      {
        accessorKey: "days_delay",
        header: ({ column }) => <SortableHeader label="Days Delay" column={column} />,
        sortingFn: (a, b) => numOrMin(a.original.days_delay) - numOrMin(b.original.days_delay),
        cell: ({ row }) => row.original.days_delay ?? dash,
      },
      {
        accessorKey: "last_updated",
        header: ({ column }) => <SortableHeader label="Last Updated" column={column} />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-slate-600">
            {formatDate(row.original.last_updated)}
          </span>
        ),
      },
      {
        accessorKey: "batch_status",
        header: ({ column }) => <SortableHeader label="Status Batches" column={column} />,
        sortingFn: (a, b) =>
          BATCH_STATUS_LABELS[a.original.batch_status].localeCompare(
            BATCH_STATUS_LABELS[b.original.batch_status]
          ),
        cell: ({ row }) => <StatusPill label={BATCH_STATUS_LABELS[row.original.batch_status]} />,
      },
      {
        accessorKey: "ready_parts",
        header: ({ column }) => <SortableHeader label="Ready Parts" column={column} />,
        cell: ({ row }) => (row.original.ready_parts ? "Yes" : "No"),
      },
      {
        accessorKey: "gap_of_ready",
        header: ({ column }) => <SortableHeader label="Gap of Ready" column={column} />,
        sortingFn: (a, b) =>
          numOrMin(a.original.gap_of_ready) - numOrMin(b.original.gap_of_ready),
        cell: ({ row }) => row.original.gap_of_ready ?? dash,
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
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          ETD Factories
        </h1>
        <p className="text-sm text-muted-foreground">
          Estimated data from the factory for the production of the category.
        </p>
      </div>

      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="PO number"
        activeCount={filterCount}
        controls={(close) => (
          <>
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
            <Button
              variant="outline"
              className="h-11 rounded-xl bg-white"
              onClick={() => {
                close();
                toast.info("Download XLS — coming soon.");
              }}
            >
              <Download />
              Download XLS
            </Button>
          </>
        )}
        trailing={() => (
          <ColumnsMenu
            columns={COLUMN_OPTIONS}
            visibility={visibility}
            onSave={saveVisibility}
          />
        )}
      />

      <FiltersModal
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        filters={filters}
        onApply={setFilters}
        onClear={() => setFilters(EMPTY_FILTERS)}
        clients={clients}
        factories={factories}
        categories={categories}
      />

      <EtdOrderModal
        orderId={modalTarget?.orderId ?? null}
        ofcId={modalTarget?.ofcId ?? null}
        title={modalTarget?.title ?? ""}
        factories={factories}
        open={!!modalTarget}
        onOpenChange={(o) => !o && setModalTarget(null)}
      />

      <DataCards
        rows={table.getRowModel().rows}
        labels={CARD_LABELS}
        titleColumnId="po_batch"
        headerColumnIds={["batch_status"]}
        emptyMessage="No entries found."
        onRowClick={(row) => openRow(row.original)}
      />

      <div className="hidden overflow-x-auto rounded-2xl border bg-white lg:block">
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
                  onClick={() => openRow(row.original)}
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
                  No entries found.
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
