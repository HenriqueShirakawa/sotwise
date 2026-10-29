"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useShipmentsRealtime } from "@/lib/use-shipments-realtime";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, ArrowUpDown, Eye, Filter } from "lucide-react";

import { formatDateNumeric } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/status-pill";
import { CardsSkeleton, TableRowsSkeleton } from "@/components/app-shell/table-page-skeleton";
import { DataCards, labelsFromOptions } from "@/components/data-cards";
import { ListToolbar } from "@/components/list-toolbar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

import { activeFilterCount, EMPTY_FILTERS, FiltersModal, type Ref } from "./filters-modal";
import {
  DEFAULT_SORT,
  SORT_COLUMNS,
  listStateToSearch,
  type ListState,
  type SortId,
  type ShipmentFilterOptions,
} from "./list-params";

/** Uma linha da página atual — filtros, busca e ordenação já rodaram no banco
 *  (view `shipments_list`, ver ./page.tsx). */
export type ShipmentRow = {
  id: string;
  pl_number: string;
  client: string | null;
  client_reference: string | null;
  order_type: string | null;
  pol: string | null;
  ship_model: string | null;
  loading_date: string | null;
  ship_date: string | null;
  eta: string | null;
  sum_of_orders: number;
  /** Uma entrada por Order deste PL — PO number + quantas linhas Factory x
   *  Category ela contribui (só as dos lotes DESTE PL, não o total da Order
   *  em outros PLs/shipments). Alimenta o popover da coluna "Sum of Orders". */
  orders_summary: { po_number: string; ofc_count: number }[];
  /** Label exibido. */
  status: string;
};

function SortableHeader({
  label,
  column,
}: {
  label: string;
  column: Column<ShipmentRow, unknown>;
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
const date = (v: string | null) => (v ? formatDateNumeric(v) : dash);
const text = (v: string | null) => v || dash;

/** Mesma mecânica do "olho" de Batches na lista de Orders: clicar no número
 *  abre um popover com o que ele soma — aqui, cada Order do PL (PO number +
 *  quantas linhas Factory x Category ela tem neste PL). */
function OrdersSummaryCell({
  orders,
}: {
  orders: { po_number: string; ofc_count: number }[];
}) {
  if (orders.length === 0) return <span className="text-slate-400">0</span>;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 whitespace-nowrap transition-colors hover:bg-slate-100 data-[state=open]:bg-primary/10 data-[state=open]:text-primary data-[state=open]:ring-1 data-[state=open]:ring-primary/30"
        >
          <Eye className="size-4 shrink-0 text-slate-400" aria-hidden />
          <span className="text-primary underline underline-offset-2">{orders.length}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        onClick={(event) => event.stopPropagation()}
        className="w-auto min-w-52 overflow-hidden py-1"
      >
        {orders.map((o) => (
          <div
            key={o.po_number}
            className="flex items-center justify-between gap-4 px-3 py-2 text-sm"
          >
            <span className="text-slate-600">PO {o.po_number}</span>
            <span className="text-xs text-muted-foreground">
              {o.ofc_count} {o.ofc_count === 1 ? "Factory x Category" : "Factories x Categories"}
            </span>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

const COLUMN_OPTIONS: ColumnOption[] = [
  { id: "pl_number", label: "PL Number" },
  { id: "client", label: "Client" },
  { id: "client_reference", label: "Client Reference" },
  { id: "order_type", label: "Order Type" },
  { id: "pol", label: "POL" },
  { id: "ship_model", label: "Ship Model" },
  { id: "loading_date", label: "Loading Date" },
  { id: "ship_date", label: "Ship Date" },
  { id: "eta", label: "ETA" },
  { id: "sum_of_orders", label: "Sum of Orders" },
  { id: "status", label: "Status" },
];

const CARD_LABELS = labelsFromOptions(COLUMN_OPTIONS);

/**
 * Lista de Shipments (docs §3.10). Sem "Create" — o Shipment nasce do Confirm
 * Shipping do PL. Clicar na linha abre o checklist completo do embarque.
 *
 * Paginada no servidor (29/10/2026): página, busca, ordenação e filtros moram na
 * URL; mudar qualquer um navega e o servidor devolve só a página nova.
 */
const NO_OPTIONS: ShipmentFilterOptions = {
  clients: [],
  profiles: [],
  orders: [],
  orderTypes: [],
  agents: [],
  carriers: [],
  pols: [],
  pods: [],
  factories: [],
  shipmentModels: [],
};
// Guardadas no módulo: voltar à lista na mesma sessão não busca de novo.
let cachedOptions: ShipmentFilterOptions | null = null;

/** Opções do modal de Filters, buscadas em segundo plano depois que a lista aparece. */
function useFilterOptions(): ShipmentFilterOptions {
  const [options, setOptions] = useState(cachedOptions ?? NO_OPTIONS);
  useEffect(() => {
    if (cachedOptions) return;
    let alive = true;
    fetch("/shipments/filter-options")
      .then((res) => {
        if (!res.ok) throw new Error(`filter-options ${res.status}`);
        return res.json() as Promise<ShipmentFilterOptions>;
      })
      .then((loaded) => {
        cachedOptions = loaded;
        if (alive) setOptions(loaded);
      })
      .catch(() => {
        // Sem opções o modal só fica com os selects vazios; a lista segue.
      });
    return () => {
      alive = false;
    };
  }, []);
  return options;
}

export function ShipmentsClient({
  rows,
  total,
  pageCount,
  state,
  initialColumns,
}: {
  rows: ShipmentRow[];
  total: number;
  pageCount: number;
  state: ListState;
  initialColumns: VisibilityState;
}) {
  const router = useRouter();

  // Realtime: a lista reflete embarque criado/alterado/excluído na hora, mesmo
  // com a tela parada e aberta. Debounce curto coalesce rajadas de pings.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useShipmentsRealtime(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 300);
  });
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    []
  );

  const [isPending, startTransition] = useTransition();
  const navigate = (next: ListState) =>
    startTransition(() => router.push(`/shipments${listStateToSearch(next)}`, { scroll: false }));

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

  const sorting: SortingState = [state.sort];
  const filters = state.filters;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { visibility, save: saveVisibility } = useColumnVisibility("shipments", initialColumns);

  const filterCount = activeFilterCount(filters);

  // pol é (cidade, porto) desnormalizado: o mesmo porto tem várias linhas (Ningbo
  // 12×, INTEGRACAO_GSS §9.3). No filtro basta o nome do porto — deduplicamos a
  // lista e casamos por nome, senão escolher "Ningbo" pegaria só 1 dos 12 ids.
  const options = useFilterOptions();
  const uniquePols = useMemo(() => {
    const byName = new Map<string, Ref>();
    for (const p of options.pols) {
      const key = p.name.trim().toLowerCase();
      if (!byName.has(key)) byName.set(key, p);
    }
    return [...byName.values()];
  }, [options.pols]);

  const columns = useMemo<ColumnDef<ShipmentRow>[]>(
    () => [
      {
        id: "pl_number",
        accessorFn: (r) => Number(r.pl_number) || 0,
        header: ({ column }) => <SortableHeader label="PL Number" column={column} />,
        cell: ({ row }) => <span className="font-medium">PL - {row.original.pl_number}</span>,
      },
      {
        id: "client",
        accessorFn: (r) => r.client ?? "",
        header: ({ column }) => <SortableHeader label="Client" column={column} />,
        cell: ({ row }) => text(row.original.client),
      },
      {
        id: "client_reference",
        accessorFn: (r) => r.client_reference ?? "",
        header: ({ column }) => <SortableHeader label="Client Reference" column={column} />,
        cell: ({ row }) => text(row.original.client_reference),
      },
      {
        id: "order_type",
        accessorFn: (r) => r.order_type ?? "",
        header: ({ column }) => <SortableHeader label="Order Type" column={column} />,
        cell: ({ row }) => text(row.original.order_type),
      },
      {
        id: "pol",
        accessorFn: (r) => r.pol ?? "",
        header: ({ column }) => <SortableHeader label="POL" column={column} />,
        cell: ({ row }) => text(row.original.pol),
      },
      {
        id: "ship_model",
        accessorFn: (r) => r.ship_model ?? "",
        header: ({ column }) => <SortableHeader label="Ship Model" column={column} />,
        cell: ({ row }) => text(row.original.ship_model),
      },
      {
        id: "loading_date",
        accessorFn: (r) => r.loading_date ?? "",
        header: ({ column }) => <SortableHeader label="Loading Date" column={column} />,
        cell: ({ row }) => date(row.original.loading_date),
      },
      {
        id: "ship_date",
        accessorFn: (r) => r.ship_date ?? "",
        header: ({ column }) => <SortableHeader label="Ship Date" column={column} />,
        cell: ({ row }) => date(row.original.ship_date),
      },
      {
        id: "eta",
        accessorFn: (r) => r.eta ?? "",
        header: ({ column }) => <SortableHeader label="ETA" column={column} />,
        cell: ({ row }) => date(row.original.eta),
      },
      {
        id: "sum_of_orders",
        accessorFn: (r) => r.sum_of_orders,
        header: ({ column }) => <SortableHeader label="Sum of Orders" column={column} />,
        cell: ({ row }) => <OrdersSummaryCell orders={row.original.orders_summary} />,
      },
      {
        id: "status",
        accessorFn: (r) => r.status,
        header: ({ column }) => <SortableHeader label="Status" column={column} />,
        cell: ({ row }) => <StatusPill label={row.original.status} />,
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
      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="PL number"
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
        {...options}
        pols={uniquePols}
      />

      <div aria-busy={isPending} className={isPending ? "pointer-events-none" : undefined}>
        {isPending ? (
          <CardsSkeleton rows={table.getRowModel().rows.length || 10} />
        ) : (
        <DataCards
        rows={table.getRowModel().rows}
        labels={CARD_LABELS}
        titleColumnId="pl_number"
        headerColumnIds={["status"]}
        emptyMessage="No shipments found."
        breakpoint="720"
        onRowClick={(row) => router.push(`/shipments/${row.original.pl_number}`)}
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
            {isPending ? (
              <TableRowsSkeleton
                columns={table.getVisibleLeafColumns().length}
                rows={table.getRowModel().rows.length || 10}
              />
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-slate-50/60"
                  onClick={() => router.push(`/shipments/${row.original.pl_number}`)}
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
                  No shipments found.
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
          <span className="ml-2 text-slate-400">· {total} shipments</span>
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="rounded-lg"
            onClick={() => navigate({ ...state, page: state.page - 1 })}
            disabled={state.page <= 1 || isPending}
            aria-label="Previous page"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="rounded-lg"
            onClick={() => navigate({ ...state, page: state.page + 1 })}
            disabled={state.page >= pageCount || isPending}
            aria-label="Next page"
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
