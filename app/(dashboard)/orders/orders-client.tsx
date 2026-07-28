"use client";

import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import {
  Search,
  Filter,
  Plus,
  Eye,
  Pencil,
  Trash2,
  Bike,
  Car,
  Sprout,
  House,
  Dumbbell,
  Boxes,
  Tag,
  FlaskConical,
  Gift,
  RefreshCw,
  Shapes,
  type LucideIcon,
} from "lucide-react";
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

function buIcon(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (n.includes("moto")) return Bike;
  if (n.includes("auto")) return Car;
  if (n.includes("agro")) return Sprout;
  if (n.startsWith("ha") || n.includes("home") || n.includes("house")) return House;
  if (n.includes("sport")) return Dumbbell;
  return Boxes;
}

function typeIcon(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (n.includes("sale")) return Tag;
  if (n.includes("sample")) return FlaskConical;
  if (n.includes("gift")) return Gift;
  if (n.includes("replac") || n.includes("exchange")) return RefreshCw;
  return Shapes;
}

function TagChip({ label, icon: Icon }: { label: string; icon: LucideIcon }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium whitespace-nowrap text-slate-700">
      <Icon className="size-3.5 text-violet-500" />
      {label}
    </span>
  );
}

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

function BatchCell({ batches }: { batches: string[] }) {
  if (batches.length === 0)
    return <Eye className="size-4 text-slate-300" aria-hidden />;
  const shown = batches.slice(0, 6).join("/");
  const extra = batches.length > 6 ? ` +${batches.length - 6}` : "";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Eye className="size-4 shrink-0 text-slate-400" aria-hidden />
      <span className="text-violet-600 underline underline-offset-2">
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
        cell: ({ row }) =>
          row.original.bu ? (
            <TagChip label={row.original.bu} icon={buIcon(row.original.bu)} />
          ) : (
            dash
          ),
      },
      {
        accessorKey: "type",
        header: "Type",
        cell: ({ row }) =>
          row.original.type ? (
            <TagChip
              label={row.original.type}
              icon={typeIcon(row.original.type)}
            />
          ) : (
            dash
          ),
      },
      {
        accessorKey: "client",
        header: "Client",
        cell: ({ row }) => (
          <span className="font-medium text-slate-800">
            {row.original.client ?? dash}
          </span>
        ),
      },
      {
        accessorKey: "po_number",
        header: "PO No.",
        cell: ({ row }) => (
          <span className="font-medium text-slate-800">
            {row.original.po_number}
          </span>
        ),
      },
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
        header: "Schedule Req.",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-slate-600">
            {formatDate(row.original.schedule_requested)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: () => (
          <div className="flex items-center justify-end gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-violet-600 hover:text-violet-700"
              aria-label="Edit"
              onClick={() => toast.info("Edit order — coming soon.")}
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-rose-500 hover:text-rose-600"
              aria-label="Delete"
              onClick={() => toast.info("Delete order — coming soon.")}
            >
              <Trash2 />
            </Button>
          </div>
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
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Orders List
          </h1>
          <p className="text-sm text-muted-foreground">Orders management</p>
        </div>
        <Button
          className="h-11 rounded-xl bg-violet-600 px-5 text-white hover:bg-violet-700"
          onClick={() => toast.info("Create Order — coming soon.")}
        >
          <Plus />
          Create Order
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type some Order"
            className="h-11 rounded-xl bg-white pl-9"
          />
        </div>
        <Select value={client} onValueChange={setClient}>
          <SelectTrigger className="!h-11 w-60 rounded-xl bg-white">
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
          className="h-11 rounded-xl bg-white"
          onClick={() => toast.info("Filters — coming soon.")}
        >
          <Filter />
          Filters
        </Button>
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
                  No orders found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
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
            className="rounded-lg bg-white"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg bg-white"
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
