"use client";

import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { Search, Filter, Plus, Eye } from "lucide-react";
import { toast } from "sonner";

import { formatDate } from "@/lib/format";
import type { OrderStatus } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type OrderRow = {
  id: string;
  po_number: string;
  bu: string | null;
  type: string | null;
  type_color: string | null;
  client: string | null;
  client_reference: string | null;
  batches: string[];
  leader: string | null;
  requester: string | null;
  exporter: string | null;
  date_create: string;
  status: OrderStatus;
  schedule_requested: string | null;
};

const STATUS: Record<OrderStatus, { label: string; cls: string }> = {
  in_negotiation: { label: "In Negotiation", cls: "border-amber-300 text-amber-600" },
  in_production: { label: "In Production", cls: "border-blue-300 text-blue-600" },
  partially_shipped: {
    label: "Partially Shipped",
    cls: "border-indigo-300 text-indigo-600",
  },
  shipped: { label: "Shipped", cls: "border-cyan-300 text-cyan-600" },
  partially_delivered: {
    label: "Partially Delivered",
    cls: "border-violet-300 text-violet-600",
  },
  delivered: { label: "Delivered", cls: "border-emerald-300 text-emerald-600" },
  canceled: { label: "Canceled", cls: "border-rose-300 text-rose-500" },
};

function StatusChip({ status }: { status: OrderStatus }) {
  const s = STATUS[status];
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium whitespace-nowrap text-slate-700">
      {label}
    </span>
  );
}

function BatchCell({ batches }: { batches: string[] }) {
  if (batches.length === 0)
    return <Eye className="size-4 text-slate-300" aria-hidden />;
  const shown = batches.slice(0, 6).join("/");
  const extra = batches.length > 6 ? ` +${batches.length - 6}` : "";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Eye className="size-4 shrink-0 text-slate-400" aria-hidden />
      <span className="text-violet-600">
        {shown}
        {extra}
      </span>
    </span>
  );
}

const dash = <span className="text-slate-300">—</span>;

export function OrdersClient({
  rows,
  clients,
}: {
  rows: OrderRow[];
  clients: { id: string; name: string }[];
}) {
  const [search, setSearch] = useState("");
  const [client, setClient] = useState("all");

  const data = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (client !== "all" && r.client !== client) return false;
      if (!q) return true;
      return (
        r.po_number.toLowerCase().includes(q) ||
        (r.client_reference ?? "").toLowerCase().includes(q) ||
        (r.client ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, client]);

  const columns = useMemo<ColumnDef<OrderRow>[]>(
    () => [
      {
        accessorKey: "bu",
        header: "BU",
        cell: ({ row }) => (row.original.bu ? <Chip label={row.original.bu} /> : dash),
      },
      {
        accessorKey: "type",
        header: "Type",
        cell: ({ row }) =>
          row.original.type ? <Chip label={row.original.type} /> : dash,
      },
      {
        accessorKey: "client",
        header: "Client",
        cell: ({ row }) => row.original.client ?? dash,
      },
      { accessorKey: "po_number", header: "PO No." },
      {
        accessorKey: "client_reference",
        header: "Client Ref.",
        cell: ({ row }) => row.original.client_reference || dash,
      },
      {
        id: "batches",
        header: "Batch No.",
        cell: ({ row }) => <BatchCell batches={row.original.batches} />,
      },
      {
        accessorKey: "leader",
        header: "Leader",
        cell: ({ row }) => row.original.leader ?? dash,
      },
      {
        accessorKey: "requester",
        header: "Requester",
        cell: ({ row }) => row.original.requester ?? dash,
      },
      {
        accessorKey: "exporter",
        header: "Exporter",
        cell: ({ row }) => row.original.exporter ?? dash,
      },
      {
        accessorKey: "date_create",
        header: "Date Create Order",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-slate-600">
            {formatDate(row.original.date_create)}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status PO",
        cell: ({ row }) => <StatusChip status={row.original.status} />,
      },
      {
        accessorKey: "schedule_requested",
        header: "Schedule",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-slate-600">
            {formatDate(row.original.schedule_requested)}
          </span>
        ),
      },
    ],
    []
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  });

  const pageIndex = table.getState().pagination.pageIndex;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Orders List</h1>
          <p className="text-sm text-muted-foreground">Orders management</p>
        </div>
        <Button
          className="bg-violet-600 text-white hover:bg-violet-700"
          onClick={() => toast.info("Create Order — coming soon.")}
        >
          <Plus />
          Create Order
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type some Order"
            className="pl-8"
          />
        </div>
        <Select value={client} onValueChange={setClient}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Choose a client" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.name}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          onClick={() => toast.info("Filters — coming soon.")}
        >
          <Filter />
          Filters
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id} className="whitespace-nowrap">
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
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
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
                  No orders found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {data.length} order{data.length === 1 ? "" : "s"}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            Page {pageIndex + 1} of {Math.max(table.getPageCount(), 1)}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
