"use client";

import { useMemo, useState, useTransition } from "react";
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
  ArrowUpDown,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { displayBu, formatDate, formatDateNumeric } from "@/lib/format";
import {
  ORDER_STATUS_LABELS,
  STATUS_COLORS,
  statusChipStyle,
} from "@/lib/status-colors";
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  const label = ORDER_STATUS_LABELS[status];
  const hex = STATUS_COLORS[label] ?? "#475569";
  return (
    <span
      style={statusChipStyle(hex)}
      className="inline-flex items-center rounded-[4px] border px-2 py-0.5 text-xs font-medium whitespace-nowrap"
    >
      {label}
    </span>
  );
}

function BatchCell({
  batches,
  focused,
  onFocus,
}: {
  batches: string[];
  focused: boolean;
  onFocus: () => void;
}) {
  if (batches.length === 0)
    return <Eye className="size-4 text-slate-300" aria-hidden />;
  const shown = batches.slice(0, 6).join("/");
  const extra = batches.length > 6 ? ` +${batches.length - 6}` : "";
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onFocus();
      }}
      aria-pressed={focused}
      className={`inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 whitespace-nowrap transition-colors ${
        focused
          ? "bg-primary/10 text-primary ring-1 ring-primary/30"
          : "hover:bg-slate-100"
      }`}
    >
      <Eye className="size-4 shrink-0 text-slate-400" aria-hidden />
      <span className="text-primary underline underline-offset-2">
        {shown}
        {extra}
      </span>
    </button>
  );
}

function SortableHeader({
  label,
  column,
}: {
  label: string;
  column: Column<OrderRow, unknown>;
}) {
  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 whitespace-nowrap hover:text-slate-700"
      onClick={column.getToggleSortingHandler()}
    >
      {label}
      <ArrowUpDown
        className={`size-3.5 ${sorted ? "text-primary" : "text-slate-400"}`}
      />
    </button>
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
  const [buFilter, setBuFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<OrderStatus>>(new Set());
  const [sorting, setSorting] = useState<SortingState>([]);
  const [focusedBatchRow, setFocusedBatchRow] = useState<string | null>(null);

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

  function toggleFilter<T>(setter: (fn: (prev: Set<T>) => Set<T>) => void, value: T) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  const activeFilterCount = buFilter.size + statusFilter.size;

  const data = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (client !== "all" && r.client !== client) return false;
      if (buFilter.size > 0 && (!r.bu || !buFilter.has(r.bu))) return false;
      if (statusFilter.size > 0 && !statusFilter.has(r.status)) return false;
      if (!q) return true;
      return (
        r.po_number.toLowerCase().includes(q) ||
        (r.client_reference ?? "").toLowerCase().includes(q) ||
        (r.client ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, client, buFilter, statusFilter]);

  const columns = useMemo<ColumnDef<OrderRow>[]>(
    () => [
      {
        accessorKey: "bu",
        header: ({ column }) => <SortableHeader label="BU" column={column} />,
        cell: ({ row }) =>
          row.original.bu ? (
            <TagChip
              label={displayBu(row.original.bu)}
              icon={buIcon(row.original.bu)}
              iconColor="#350065"
            />
          ) : (
            dash
          ),
      },
      {
        accessorKey: "type",
        header: ({ column }) => <SortableHeader label="Type" column={column} />,
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
        header: ({ column }) => <SortableHeader label="Client" column={column} />,
        cell: ({ row }) => (
          <span className="font-medium text-slate-800">
            {row.original.client ?? dash}
          </span>
        ),
      },
      {
        accessorKey: "po_number",
        header: ({ column }) => <SortableHeader label="PO No." column={column} />,
        sortingFn: (a, b) =>
          (Number(a.original.po_number) || 0) - (Number(b.original.po_number) || 0),
        cell: ({ row }) => (
          <span className="font-medium text-slate-800">
            {row.original.po_number}
          </span>
        ),
      },
      {
        accessorKey: "client_reference",
        header: ({ column }) => (
          <SortableHeader label="Client Ref." column={column} />
        ),
        cell: ({ row }) => row.original.client_reference || dash,
      },
      {
        id: "batches",
        header: "Batch No.",
        enableSorting: false,
        cell: ({ row }) => (
          <BatchCell
            batches={row.original.batches}
            focused={focusedBatchRow === row.original.id}
            onFocus={() =>
              setFocusedBatchRow((id) =>
                id === row.original.id ? null : row.original.id
              )
            }
          />
        ),
      },
      {
        accessorKey: "leader",
        header: ({ column }) => <SortableHeader label="Leader" column={column} />,
        cell: ({ row }) => row.original.leader ?? dash,
      },
      {
        accessorKey: "requester",
        header: ({ column }) => (
          <SortableHeader label="Requester" column={column} />
        ),
        cell: ({ row }) => row.original.requester ?? dash,
      },
      {
        accessorKey: "exporter",
        header: ({ column }) => (
          <SortableHeader label="Exporter" column={column} />
        ),
        cell: ({ row }) => row.original.exporter ?? dash,
      },
      {
        accessorKey: "date_create",
        header: ({ column }) => (
          <SortableHeader label="Date Create Order" column={column} />
        ),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-slate-600">
            {formatDate(row.original.date_create)}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => <SortableHeader label="Status PO" column={column} />,
        cell: ({ row }) => <StatusChip status={row.original.status} />,
      },
      {
        accessorKey: "schedule_requested",
        header: ({ column }) => (
          <SortableHeader label="Schedule Req." column={column} />
        ),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-slate-600">
            {formatDateNumeric(row.original.schedule_requested)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <div
            className="flex items-center justify-end gap-0.5"
            onClick={(event) => event.stopPropagation()}
          >
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
    [focusedBatchRow]
  );

  const table = useReactTable({
    data,
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-11 rounded-xl bg-white">
              <Filter />
              Filters
              {activeFilterCount > 0 && (
                <span className="ml-1 inline-flex size-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>Business Unit</DropdownMenuLabel>
            {businessUnits.map((b) => (
              <DropdownMenuCheckboxItem
                key={b.id}
                checked={buFilter.has(b.name)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={() => toggleFilter(setBuFilter, b.name)}
              >
                {displayBu(b.name)}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Status</DropdownMenuLabel>
            {(Object.entries(ORDER_STATUS_LABELS) as [OrderStatus, string][]).map(
              ([value, label]) => (
                <DropdownMenuCheckboxItem
                  key={value}
                  checked={statusFilter.has(value)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => toggleFilter(setStatusFilter, value)}
                >
                  {label}
                </DropdownMenuCheckboxItem>
              )
            )}
            {activeFilterCount > 0 && (
              <>
                <DropdownMenuSeparator />
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-center"
                  onClick={() => {
                    setBuFilter(new Set());
                    setStatusFilter(new Set());
                  }}
                >
                  Clear filters
                </Button>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
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
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-slate-50/60"
                  onClick={() => router.push(`/orders/${row.original.id}`)}
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
