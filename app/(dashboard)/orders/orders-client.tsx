"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  Download,
  ChevronLeft,
  ChevronRight,
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
import { ConfirmDialog } from "@/components/confirm-dialog";

import { deleteOrder } from "./actions";
import { OrderFormModal } from "./order-form-modal";

export type Ref = { id: string; name: string };

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
  // FK ids — usados para pré-selecionar o modal de edição.
  order_type_id: string | null;
  client_id: string | null;
  business_unit_id: string | null;
  requester_id: string | null;
  exporter_id: string | null;
  leader_id: string | null;
};

const STATUS: Record<OrderStatus, { label: string; cls: string }> = {
  in_negotiation: {
    label: "In Negotiation",
    cls: "border-amber-200 bg-amber-50 text-amber-700",
  },
  in_production: {
    label: "In Production",
    cls: "border-red-200 bg-red-50 text-red-600",
  },
  partially_shipped: {
    label: "Partially Shipped",
    cls: "border-blue-200 bg-blue-50 text-blue-600",
  },
  shipped: { label: "Shipped", cls: "border-cyan-200 bg-cyan-50 text-cyan-700" },
  partially_delivered: {
    label: "Partially Delivered",
    cls: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
  },
  delivered: {
    label: "Delivered",
    cls: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  canceled: {
    label: "Canceled",
    cls: "border-rose-200 bg-rose-50 text-rose-600",
  },
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

function TagChip({
  label,
  icon: Icon,
  iconColor = "#9500A8",
}: {
  label: string;
  icon: LucideIcon;
  iconColor?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium whitespace-nowrap text-gray-700">
      <Icon className="size-3.5" style={{ color: iconColor }} />
      {label}
    </span>
  );
}

function StatusChip({ status }: { status: OrderStatus }) {
  const s = STATUS[status];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${s.cls}`}
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
      <span className="text-primary underline underline-offset-2">
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
  orderTypes,
  businessUnits,
  exporters,
  profiles,
}: {
  rows: OrderRow[];
  clients: Ref[];
  orderTypes: Ref[];
  businessUnits: Ref[];
  exporters: Ref[];
  profiles: Ref[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [client, setClient] = useState("all");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<OrderRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OrderRow | null>(null);
  const [pending, startTransition] = useTransition();

  // Próximo número de PO (auto-gerado) = maior número + 1, igual ao Bubble.
  const nextPo = useMemo(
    () =>
      String(rows.reduce((m, r) => Math.max(m, Number(r.po_number) || 0), 0) + 1),
    [rows]
  );

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    startTransition(async () => {
      const res = await deleteOrder(id);
      if (res.ok) {
        toast.success("Order deleted.");
        router.refresh();
      } else {
        toast.error(res.error);
      }
      setDeleteTarget(null);
    });
  }

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
            <TagChip
              label={row.original.bu}
              icon={buIcon(row.original.bu)}
              iconColor="#350065"
            />
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
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-primary hover:text-primary/80"
              aria-label="Edit"
              onClick={() => {
                setEditing(row.original);
                setFormOpen(true);
              }}
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-rose-500 hover:text-rose-600"
              aria-label="Delete"
              onClick={() => setDeleteTarget(row.original)}
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
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Orders
          </h1>
          <p className="text-sm text-muted-foreground">Orders management</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            className="h-11 rounded-xl"
            onClick={() => toast.info("Download XLS — coming soon.")}
          >
            <Download />
            Download XLS
          </Button>
          <Button className="h-11 rounded-xl px-5" onClick={openCreate}>
            <Plus />
            Create Order
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="PO number"
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

      <OrderFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        nextPo={nextPo}
        orderTypes={orderTypes}
        clients={clients}
        businessUnits={businessUnits}
        exporters={exporters}
        profiles={profiles}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete order?"
        description={
          deleteTarget
            ? `Order ${deleteTarget.po_number} will be removed from the list.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        loading={pending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
