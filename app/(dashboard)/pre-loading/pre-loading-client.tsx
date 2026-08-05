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
  type VisibilityState,
} from "@tanstack/react-table";
import {
  ColumnsMenu,
  useColumnVisibility,
  type ColumnOption,
} from "@/components/columns-menu";
import {
  Filter,
  Download,
  Plus,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
} from "lucide-react";
import { toast } from "sonner";

import { formatDateNumeric } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataCards, labelsFromOptions } from "@/components/data-cards";
import { ListToolbar } from "@/components/list-toolbar";

import { deletePreLoading } from "./actions";
import { PreLoadingFormModal, type BatchOption } from "./pre-loading-form-modal";
import {
  activeFilterCount,
  EMPTY_FILTERS,
  FiltersModal,
  type PreLoadingFilters,
  type Ref,
} from "./filters-modal";

export type PreLoadingRow = {
  id: string;
  pl_number: string;
  created_date: string;
  client: string | null;
  client_ids: string[];
  client_reference: string | null;
  responsible_signer_id: string | null;
  leader: string | null;
  leader_id: string | null;
  consolidation_point: string | null;
  consolidation_point_id: string | null;
  pol: string | null;
  pol_id: string | null;
  pod: string | null;
  pod_id: string | null;
  loading_date: string | null;
  completed: boolean;
  booking_confirmed: boolean;
  total_pos: number;
  order_ids: string[];
  batch_ids: string[];
  agent_brazil_id: string | null;
  agent_china_id: string | null;
  carrier_ids: string[];
};

function SortableHeader({
  label,
  column,
}: {
  label: string;
  column: Column<PreLoadingRow, unknown>;
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

/** Colunas que o usuário pode esconder — "actions" fica sempre visível. */
const COLUMN_OPTIONS: ColumnOption[] = [
  { id: "pl_number", label: "PL No." },
  { id: "client", label: "Client" },
  { id: "client_reference", label: "Client Reference" },
  { id: "leader", label: "Leader" },
  { id: "consolidation_point", label: "Cons. Point" },
  { id: "pol", label: "POL" },
  { id: "pod", label: "POD" },
  { id: "loading_date", label: "Loading Date" },
  { id: "completed", label: "Preloading completed?" },
  { id: "booking_confirmed", label: "Booking Status" },
  { id: "total_pos", label: "Total PO's" },
];

const CARD_LABELS = labelsFromOptions(COLUMN_OPTIONS);

const comingSoon = () => toast.info("Coming soon.");

/** Compara datas como string "YYYY-MM-DD" (funciona pra date e timestamp ISO). */
function inDateRange(value: string | null, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!value) return false;
  const d = value.length >= 10 ? value.slice(0, 10) : value;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

export function PreLoadingClient({
  rows,
  clients,
  profiles,
  agents,
  carriers,
  pols,
  pods,
  factories,
  orders,
  batchOptions,
  nextPlNumber,
  today,
  initialColumns,
}: {
  rows: PreLoadingRow[];
  clients: Ref[];
  profiles: Ref[];
  agents: Ref[];
  carriers: Ref[];
  pols: Ref[];
  pods: Ref[];
  factories: Ref[];
  orders: Ref[];
  batchOptions: BatchOption[];
  nextPlNumber: string;
  today: string;
  initialColumns: VisibilityState;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<PreLoadingFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([{ id: "pl_number", desc: true }]);
  const { visibility, save: saveVisibility } = useColumnVisibility("pre-loading", initialColumns);
  const [toDelete, setToDelete] = useState<PreLoadingRow | null>(null);
  const [isDeleting, startDelete] = useTransition();
  // `formOpen` sem `editing` = criação; com `editing` = edição (mesmo modal,
  // ver docs/regras_de_negocio.md §3.9.2).
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PreLoadingRow | null>(null);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (row: PreLoadingRow) => {
    setEditing(row);
    setFormOpen(true);
  };

  const filterCount = activeFilterCount(filters);

  const data = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filters.client_id && !r.client_ids.includes(filters.client_id)) return false;
      if (
        filters.client_reference &&
        !(r.client_reference ?? "").toLowerCase().includes(filters.client_reference.toLowerCase())
      )
        return false;
      if (filters.leader_id && r.leader_id !== filters.leader_id) return false;
      if (filters.order_id && !r.order_ids.includes(filters.order_id)) return false;
      if (filters.agent_brazil_id && r.agent_brazil_id !== filters.agent_brazil_id) return false;
      if (filters.agent_china_id && r.agent_china_id !== filters.agent_china_id) return false;
      if (filters.carrier_id && !r.carrier_ids.includes(filters.carrier_id)) return false;
      if (filters.pol_id && r.pol_id !== filters.pol_id) return false;
      if (filters.pod_id && r.pod_id !== filters.pod_id) return false;
      if (filters.consolidation_point_id && r.consolidation_point_id !== filters.consolidation_point_id)
        return false;
      if (!inDateRange(r.loading_date, filters.loading_from, filters.loading_to)) return false;
      if (!q) return true;
      return r.pl_number.toLowerCase().includes(q);
    });
  }, [rows, search, filters]);

  const columns = useMemo<ColumnDef<PreLoadingRow>[]>(
    () => [
      {
        accessorKey: "pl_number",
        header: ({ column }) => <SortableHeader label="PL No." column={column} />,
        sortingFn: (a, b) => (Number(a.original.pl_number) || 0) - (Number(b.original.pl_number) || 0),
        cell: ({ row }) => (
          <span className="font-medium whitespace-nowrap text-slate-800">
            {row.original.pl_number}
          </span>
        ),
      },
      {
        accessorKey: "client",
        header: ({ column }) => <SortableHeader label="Client" column={column} />,
        cell: ({ row }) => (
          <span className="font-medium text-slate-800">{row.original.client ?? dash}</span>
        ),
      },
      {
        accessorKey: "client_reference",
        header: ({ column }) => <SortableHeader label="Client Reference" column={column} />,
        cell: ({ row }) => row.original.client_reference ?? dash,
      },
      {
        accessorKey: "leader",
        header: ({ column }) => <SortableHeader label="Leader" column={column} />,
        cell: ({ row }) => row.original.leader ?? dash,
      },
      {
        accessorKey: "consolidation_point",
        header: ({ column }) => <SortableHeader label="Cons. Point" column={column} />,
        cell: ({ row }) => row.original.consolidation_point ?? dash,
      },
      {
        accessorKey: "pol",
        header: ({ column }) => <SortableHeader label="POL" column={column} />,
        cell: ({ row }) => row.original.pol ?? dash,
      },
      {
        accessorKey: "pod",
        header: ({ column }) => <SortableHeader label="POD" column={column} />,
        cell: ({ row }) => row.original.pod ?? dash,
      },
      {
        accessorKey: "loading_date",
        header: ({ column }) => <SortableHeader label="Loading Date" column={column} />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-slate-600">
            {formatDateNumeric(row.original.loading_date)}
          </span>
        ),
      },
      {
        accessorKey: "completed",
        header: ({ column }) => <SortableHeader label="Preloading completed?" column={column} />,
        cell: ({ row }) => (row.original.completed ? "Yes" : "No"),
      },
      {
        accessorKey: "booking_confirmed",
        header: ({ column }) => <SortableHeader label="Booking Status" column={column} />,
        cell: ({ row }) => (row.original.booking_confirmed ? "Yes" : "No"),
      },
      {
        accessorKey: "total_pos",
        header: ({ column }) => <SortableHeader label="Total PO's" column={column} />,
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-slate-500 hover:text-primary"
              onClick={(e) => {
                e.stopPropagation();
                openEdit(row.original);
              }}
              aria-label="Edit"
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-slate-500 hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                setToDelete(row.original);
              }}
              aria-label="Delete"
            >
              <Trash2 className="size-4" />
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
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    onColumnVisibilityChange: (updater) =>
      saveVisibility(typeof updater === "function" ? updater(visibility) : updater),
    state: { sorting, columnVisibility: visibility },
    initialState: { pagination: { pageSize: 10 } },
  });

  const pageIndex = table.getState().pagination.pageIndex;

  const handleDelete = () => {
    if (!toDelete) return;
    startDelete(async () => {
      const res = await deletePreLoading(toDelete.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Pre-loading ${toDelete.pl_number} deleted.`);
      setToDelete(null);
    });
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Pre-loading list
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage and track the status of the scheduled shipments for each production
          </p>
        </div>
        <div className="flex w-full items-center gap-3 sm:w-auto">
          <Button
            variant="outline"
            className="h-11 flex-1 rounded-xl sm:flex-none"
            onClick={comingSoon}
          >
            <Download />
            Download XLS
          </Button>
          <Button className="h-11 flex-1 rounded-xl px-5 sm:flex-none" onClick={openCreate}>
            <Plus />
            Create pre-loading
          </Button>
        </div>
      </div>

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

      <PreLoadingFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        nextPlNumber={nextPlNumber}
        today={today}
        clients={clients}
        profiles={profiles}
        pods={pods}
        batchOptions={batchOptions}
      />

      <FiltersModal
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        filters={filters}
        onApply={setFilters}
        onClear={() => setFilters(EMPTY_FILTERS)}
        clients={clients}
        profiles={profiles}
        agents={agents}
        carriers={carriers}
        pols={pols}
        pods={pods}
        factories={factories}
        orders={orders}
      />

      <DataCards
        rows={table.getRowModel().rows}
        labels={CARD_LABELS}
        titleColumnId="pl_number"
        emptyMessage="No entries found."
        onRowClick={(row) => router.push(`/pre-loading/${row.original.id}`)}
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
                  onClick={() => router.push(`/pre-loading/${row.original.id}`)}
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

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete pre-loading?"
        description={
          toDelete
            ? `This will remove PL ${toDelete.pl_number} from the list. This action can be undone by an admin.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        loading={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
