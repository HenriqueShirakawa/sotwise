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
import { ChevronLeft, ChevronRight, ArrowUpDown, Filter } from "lucide-react";

import { formatDateNumeric } from "@/lib/format";
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
  type ShipmentFilters,
} from "./filters-modal";

export type ShipmentRow = {
  id: string;
  pl_number: string;
  client: string | null;
  client_ids: string[];
  order_type: string | null;
  order_type_ids: string[];
  order_ids: string[];
  leader_id: string | null;
  pol: string | null;
  pol_id: string | null;
  pod_id: string | null;
  consolidation_point_id: string | null;
  agent_brazil_id: string | null;
  agent_china_id: string | null;
  carrier_id: string | null;
  container_number: string | null;
  ship_model: string | null;
  shipment_model_id: string | null;
  loading_date: string | null;
  ship_date: string | null;
  eta: string | null;
  /** Sem coluna na lista — existem só pra alimentar os filtros (docs §3.10.2). */
  bl_date: string | null;
  ata_date: string | null;
  delivered_date: string | null;
  sum_of_orders: number;
  /** Label exibido; `status_value` é o valor cru, que o filtro compara. */
  status: string;
  status_value: string;
};

function inDateRange(value: string | null, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!value) return false;
  const d = value.length >= 10 ? value.slice(0, 10) : value;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

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

const COLUMN_OPTIONS: ColumnOption[] = [
  { id: "pl_number", label: "PL Number" },
  { id: "client", label: "Client" },
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
 */
export function ShipmentsClient({
  rows,
  initialColumns,
  clients,
  profiles,
  orders,
  orderTypes,
  agents,
  carriers,
  pols,
  pods,
  factories,
  shipmentModels,
}: {
  rows: ShipmentRow[];
  initialColumns: VisibilityState;
  clients: Ref[];
  profiles: Ref[];
  orders: Ref[];
  orderTypes: Ref[];
  agents: Ref[];
  carriers: Ref[];
  pols: Ref[];
  pods: Ref[];
  factories: Ref[];
  shipmentModels: Ref[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "pl_number", desc: true }]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<ShipmentFilters>(EMPTY_FILTERS);
  const { visibility, save: saveVisibility } = useColumnVisibility("shipments", initialColumns);

  const filterCount = activeFilterCount(filters);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filters.client_id && !r.client_ids.includes(filters.client_id)) return false;
      if (filters.status && r.status_value !== filters.status) return false;
      if (filters.leader_id && r.leader_id !== filters.leader_id) return false;
      if (filters.order_id && !r.order_ids.includes(filters.order_id)) return false;
      if (filters.order_type_id && !r.order_type_ids.includes(filters.order_type_id)) return false;
      if (filters.agent_brazil_id && r.agent_brazil_id !== filters.agent_brazil_id) return false;
      if (filters.agent_china_id && r.agent_china_id !== filters.agent_china_id) return false;
      if (filters.carrier_id && r.carrier_id !== filters.carrier_id) return false;
      if (
        filters.container_number &&
        !(r.container_number ?? "")
          .toLowerCase()
          .includes(filters.container_number.trim().toLowerCase())
      )
        return false;
      if (
        filters.consolidation_point_id &&
        r.consolidation_point_id !== filters.consolidation_point_id
      )
        return false;
      if (filters.pol_id && r.pol_id !== filters.pol_id) return false;
      if (filters.pod_id && r.pod_id !== filters.pod_id) return false;
      if (filters.shipment_model_id && r.shipment_model_id !== filters.shipment_model_id)
        return false;
      if (!inDateRange(r.loading_date, filters.loading_from, filters.loading_to)) return false;
      if (!inDateRange(r.ship_date, filters.ship_from, filters.ship_to)) return false;
      if (!inDateRange(r.bl_date, filters.bl_from, filters.bl_to)) return false;
      if (!inDateRange(r.eta, filters.eta_from, filters.eta_to)) return false;
      if (!inDateRange(r.ata_date, filters.ata_from, filters.ata_to)) return false;
      if (!inDateRange(r.delivered_date, filters.delivered_from, filters.delivered_to))
        return false;
      if (!q) return true;
      return r.pl_number.toLowerCase().includes(q);
    });
  }, [rows, search, filters]);

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
        cell: ({ row }) => row.original.sum_of_orders,
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
    data: filtered,
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
        onApply={setFilters}
        onClear={() => setFilters(EMPTY_FILTERS)}
        clients={clients}
        profiles={profiles}
        orders={orders}
        orderTypes={orderTypes}
        agents={agents}
        carriers={carriers}
        pols={pols}
        pods={pods}
        factories={factories}
        shipmentModels={shipmentModels}
      />

      <DataCards
        rows={table.getRowModel().rows}
        labels={CARD_LABELS}
        titleColumnId="pl_number"
        headerColumnIds={["status"]}
        emptyMessage="No shipments found."
        onRowClick={(row) => router.push(`/shipments/${row.original.id}`)}
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
                  onClick={() => router.push(`/shipments/${row.original.id}`)}
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
