"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
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
import { useEtdRealtime } from "@/lib/use-etd-realtime";
import { useOrdersRealtime } from "@/lib/use-orders-realtime";
import { usePreLoadingRealtime } from "@/lib/use-preloading-realtime";
import { useShipmentsRealtime } from "@/lib/use-shipments-realtime";
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
import { CardsSkeleton, TableRowsSkeleton } from "@/components/app-shell/table-page-skeleton";
import { DataCards, labelsFromOptions } from "@/components/data-cards";
import { ListToolbar } from "@/components/list-toolbar";
import {
  ColumnsMenu,
  useColumnVisibility,
  type ColumnOption,
} from "@/components/columns-menu";

import { activeFilterCount, EMPTY_FILTERS, FiltersModal } from "./filters-modal";
import {
  DEFAULT_SORT,
  SORT_COLUMNS,
  listStateToSearch,
  type ListState,
  type SortId,
} from "./list-params";
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
  inspection: boolean;
  dispatch_location: string | null;
  dispatch_date: string | null;
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
  { id: "inspection", label: "Insp." },
  { id: "dispatch_location", label: "Dispatch loc." },
  { id: "dispatch_date", label: "Dispatch date" },
];

const CARD_LABELS = labelsFromOptions(COLUMN_OPTIONS);

export function EtdFactoriesClient({
  rows,
  total,
  pageCount,
  state,
  clients,
  factories,
  categories,
  initialColumns,
}: {
  rows: EtdFactoryRow[];
  total: number;
  pageCount: number;
  state: ListState;
  clients: Ref[];
  factories: Ref[];
  categories: Ref[];
  initialColumns: VisibilityState;
}) {
  const router = useRouter();

  // Paginada no servidor (29/10/2026): página, busca, ordenação e filtros moram
  // na URL; mudar qualquer um navega e o servidor devolve só a página nova
  // (view `etd_list`, ver ./page.tsx).
  const [navigating, startNavigation] = useTransition();
  const navigate = (next: ListState) =>
    startNavigation(() =>
      router.push(`/etd-factories${listStateToSearch(next)}`, { scroll: false })
    );

  // Busca: digita livre, vai pra URL depois de uma pausa (volta pra página 1).
  const [search, setSearch] = useState(state.q);
  const lastQ = useRef(state.q);
  useEffect(() => {
    // URL mudou por fora (voltar do navegador, limpar): o campo acompanha.
    if (state.q !== lastQ.current) {
      lastQ.current = state.q;
      setSearch(state.q);
    }
  }, [state.q]);
  useEffect(() => {
    const q = search.trim();
    if (q === lastQ.current) return;
    const t = setTimeout(() => {
      lastQ.current = q;
      navigate({ ...state, q, page: 1 });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const filters = state.filters;
  const sorting: SortingState = [state.sort];
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { visibility, save: saveVisibility } = useColumnVisibility("etd-factories", initialColumns);
  const [modalTarget, setModalTarget] = useState<{
    orderId: string;
    ofcId: string;
    title: string;
  } | null>(null);

  // Realtime (mesmo modelo do TO-DO): ETD salvo, entrada Factory×Category
  // criada/movida, lote mudando de status, PL criado ou embarque confirmado —
  // a lista reflete sem F5. Debounce curto coalesce rajadas num só refresh.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 300);
  };
  useEtdRealtime(scheduleRefresh);
  useOrdersRealtime(scheduleRefresh);
  usePreLoadingRealtime(scheduleRefresh);
  useShipmentsRealtime(scheduleRefresh);

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
      {
        accessorKey: "inspection",
        header: ({ column }) => <SortableHeader label="Insp." column={column} />,
        cell: ({ row }) => (row.original.inspection ? "Yes" : "No"),
      },
      {
        accessorKey: "dispatch_location",
        header: ({ column }) => <SortableHeader label="Dispatch loc." column={column} />,
        cell: ({ row }) => row.original.dispatch_location ?? dash,
      },
      {
        accessorKey: "dispatch_date",
        header: ({ column }) => <SortableHeader label="Dispatch date" column={column} />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-slate-600">
            {formatDateNumeric(row.original.dispatch_date)}
          </span>
        ),
      },
    ],
    []
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    pageCount,
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const s = next[0];
      navigate({
        ...state,
        sort: s && s.id in SORT_COLUMNS ? { id: s.id as SortId, desc: s.desc } : DEFAULT_SORT,
        page: 1,
      });
    },
    onColumnVisibilityChange: (updater) =>
      saveVisibility(typeof updater === "function" ? updater(visibility) : updater),
    state: { sorting, columnVisibility: visibility },
  });

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
        onApply={(next) => navigate({ ...state, filters: next, page: 1 })}
        onClear={() => navigate({ ...state, filters: EMPTY_FILTERS, page: 1 })}
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

      <div aria-busy={navigating} className={navigating ? "pointer-events-none" : undefined}>
      {navigating ? (
        <CardsSkeleton rows={table.getRowModel().rows.length || 10} />
      ) : (
      <DataCards
        rows={table.getRowModel().rows}
        labels={CARD_LABELS}
        titleColumnId="po_batch"
        headerColumnIds={["batch_status"]}
        emptyMessage="No entries found."
        breakpoint="720"
        onRowClick={(row) => openRow(row.original)}
      />
      )}

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
            {navigating ? (
              <TableRowsSkeleton
                columns={table.getVisibleLeafColumns().length}
                rows={table.getRowModel().rows.length || 10}
              />
            ) : table.getRowModel().rows.length ? (
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
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Page {state.page} of {pageCount}
          <span className="ml-2 text-slate-400">· {total} entries</span>
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="rounded-lg"
            onClick={() => navigate({ ...state, page: state.page - 1 })}
            disabled={state.page <= 1 || navigating}
            aria-label="Previous page"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="rounded-lg"
            onClick={() => navigate({ ...state, page: state.page + 1 })}
            disabled={state.page >= pageCount || navigating}
            aria-label="Next page"
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
