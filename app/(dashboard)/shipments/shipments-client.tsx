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
} from "@tanstack/react-table";
import { Search, ChevronLeft, ChevronRight, ArrowUpDown } from "lucide-react";

import { formatDateNumeric } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/status-pill";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type ShipmentRow = {
  id: string;
  pl_number: string;
  client: string | null;
  order_type: string | null;
  pol: string | null;
  ship_model: string | null;
  loading_date: string | null;
  ship_date: string | null;
  eta: string | null;
  sum_of_orders: number;
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

/**
 * Lista de Shipments (docs §3.10). Sem "Create" (o Shipment nasce do Confirm
 * Shipping do PL) e, por ora, sem filtros/detalhe — fase 1 é só a visibilidade.
 */
export function ShipmentsClient({ rows }: { rows: ShipmentRow[] }) {
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "pl_number", desc: true }]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.pl_number.toLowerCase().includes(q));
  }, [rows, search]);

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
    state: { sorting },
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
            placeholder="PL number"
            className="h-11 rounded-xl bg-white pl-9"
          />
        </div>
      </div>

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
