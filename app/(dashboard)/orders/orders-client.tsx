"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useOrdersRealtime } from "@/lib/use-orders-realtime";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  Filter,
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
import type { ListStateSeed } from "@/lib/list-state";
import { BATCH_STATUS_LABELS, ORDER_STATUS_LABELS } from "@/lib/status-colors";
import type { BatchStatus, OrderStatus } from "@/types/database";
import { Button } from "@/components/ui/button";
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
import { DataCards, labelsFromOptions } from "@/components/data-cards";
import { useListState } from "@/components/keep-filters";
import { ListToolbar } from "@/components/list-toolbar";
import { StatusPill } from "@/components/status-pill";
import {
  ColumnsMenu,
  useColumnVisibility,
  type ColumnOption,
} from "@/components/columns-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { deleteOrder } from "./actions";
import { OrderFormModal } from "./order-form-modal";
import { activeFilterCount, EMPTY_FILTERS, FiltersModal } from "./filters-modal";
import {
  DEFAULT_SORT,
  SORT_COLUMNS,
  listStateToSearch,
  type ListState,
  type SortId,
} from "./list-params";

export type Ref = { id: string; name: string };

export type OrderRow = {
  id: string;
  po_number: string;
  bu: string | null;
  type: string | null;
  type_color: string | null;
  client: string | null;
  client_reference: string | null;
  batches: { batch_number: string; status: BatchStatus }[];
  leader: string | null;
  operational_responsible: string | null;
  requester: string | null;
  exporter: string | null;
  date_create: string;
  status: OrderStatus;
  schedule_requested: string | null;
  etd: string | null;
  // FK ids — usados para pré-selecionar o modal de edição.
  order_type_id: string | null;
  client_id: string | null;
  business_unit_id: string | null;
  requester_id: string | null;
  exporter_id: string | null;
  leader_id: string | null;
  operational_responsible_id: string | null;
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

function BatchCell({
  batches,
}: {
  batches: { batch_number: string; status: BatchStatus }[];
}) {
  if (batches.length === 0)
    return <Eye className="size-4 text-slate-300" aria-hidden />;
  const shown = batches
    .slice(0, 6)
    .map((b) => b.batch_number)
    .join("/");
  const extra = batches.length > 6 ? ` +${batches.length - 6}` : "";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 whitespace-nowrap transition-colors hover:bg-slate-100 data-[state=open]:bg-primary/10 data-[state=open]:text-primary data-[state=open]:ring-1 data-[state=open]:ring-primary/30"
        >
          <Eye className="size-4 shrink-0 text-slate-400" aria-hidden />
          <span className="text-primary underline underline-offset-2">
            {shown}
            {extra}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        onClick={(event) => event.stopPropagation()}
        className="w-auto min-w-40 overflow-hidden py-1"
      >
        {batches.map((b) => (
          <div
            key={b.batch_number}
            className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
          >
            <span className="text-slate-600">{b.batch_number}</span>
            <StatusPill label={BATCH_STATUS_LABELS[b.status]} />
          </div>
        ))}
      </PopoverContent>
    </Popover>
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

/** Order só é deletável nas fases iniciais ou cancelada (mesma regra do server
 *  em orders/actions.ts) — depois disso há PL/Shipment dependentes. */
const DELETABLE_ORDER_STATUSES: OrderStatus[] = [
  "in_negotiation",
  "in_production",
  "canceled",
];

/** Lixeira da Order: desabilitada (com tooltip do porquê) quando o status não
 *  permite excluir. Botão disabled não dispara hover, então o gatilho do tooltip
 *  é um <span> em volta. */
function DeleteOrderButton({
  status,
  onDelete,
}: {
  status: OrderStatus;
  onDelete: () => void;
}) {
  const button = (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-rose-500 hover:text-rose-600 disabled:text-slate-300 disabled:hover:text-slate-300"
      aria-label="Delete"
      disabled={!DELETABLE_ORDER_STATUSES.includes(status)}
      onClick={onDelete}
    >
      <Trash2 />
    </Button>
  );
  if (DELETABLE_ORDER_STATUSES.includes(status)) return button;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex cursor-not-allowed">
            {button}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Only orders in Negotiation, Production or Canceled can be deleted.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Colunas que o usuário pode esconder — "actions" fica sempre visível. */
const COLUMN_OPTIONS: ColumnOption[] = [
  { id: "bu", label: "BU" },
  { id: "type", label: "Type" },
  { id: "client", label: "Client" },
  { id: "po_number", label: "PO No." },
  { id: "client_reference", label: "Client Ref." },
  { id: "batches", label: "Batches" },
  { id: "operational_responsible", label: "Operational Responsible" },
  { id: "leader", label: "Leader" },
  { id: "requester", label: "Requester" },
  { id: "exporter", label: "Exporter" },
  { id: "date_create", label: "Date Create Order" },
  { id: "status", label: "Status PO" },
  { id: "schedule_requested", label: "Schedule Req." },
];

const CARD_LABELS = labelsFromOptions(COLUMN_OPTIONS);

export function OrdersClient({
  rows,
  total,
  pageCount,
  state,
  clients,
  orderTypes,
  businessUnits,
  exporters,
  profiles,
  operationalUsers,
  initialColumns,
  initialListState,
}: {
  rows: OrderRow[];
  total: number;
  pageCount: number;
  state: ListState;
  clients: Ref[];
  orderTypes: Ref[];
  businessUnits: Ref[];
  exporters: Ref[];
  profiles: Ref[];
  /** Opções do Operational Responsible: só usuários internos ativos. */
  operationalUsers: Ref[];
  initialColumns: VisibilityState;
  initialListState: ListStateSeed;
}) {
  const router = useRouter();

  // Realtime: o Status PO (e o popover de status por lote) reflete na hora
  // quando um lote muda de status em qualquer lugar — mesmo com esta tela
  // parada e aberta. Debounce curto coalesce rajadas de pings num só refresh.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useOrdersRealtime(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 300);
  });
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    []
  );

  // Paginada no servidor (29/10/2026): página, busca, cliente, ordenação e
  // filtros moram na URL; mudar qualquer um navega e o servidor devolve só a
  // página nova (view `orders_list`, ver ./page.tsx).
  const [navigating, startNavigation] = useTransition();
  const navigate = (next: ListState) =>
    startNavigation(() => router.push(`/orders${listStateToSearch(next)}`, { scroll: false }));

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

  // "Keep filters" (components/keep-filters): o estado da URL é gravado no
  // usuário a cada mudança; abrir a lista sem nada na URL volta ao que ficou
  // gravado (ex.: voltando do detalhe da order).
  const list = useListState("orders", initialListState, {
    search: "",
    client: "all",
    filters: EMPTY_FILTERS,
    sorting: [DEFAULT_SORT] as SortingState,
    pageIndex: 0,
  });
  // `state` só muda de referência quando o servidor devolve uma página nova.
  useEffect(() => {
    list.update({
      search: state.q,
      client: state.client || "all",
      filters: state.filters,
      sorting: [state.sort],
      pageIndex: state.page - 1,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const saved = list.state;
    const savedSort = saved.sorting[0];
    const fromSaved: ListState = {
      q: saved.search,
      client: saved.client === "all" ? "" : saved.client,
      filters: { ...EMPTY_FILTERS, ...saved.filters },
      sort:
        savedSort && savedSort.id in SORT_COLUMNS
          ? { id: savedSort.id as SortId, desc: savedSort.desc }
          : DEFAULT_SORT,
      page: saved.pageIndex + 1,
    };
    const target = listStateToSearch(fromSaved);
    if (list.keep && listStateToSearch(state) === "" && target !== "") {
      startNavigation(() => router.replace(`/orders${target}`, { scroll: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { visibility, save: saveVisibility } = useColumnVisibility("orders", initialColumns);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<OrderRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OrderRow | null>(null);
  const [pending, startTransition] = useTransition();

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

  // O select de cliente fica fora do modal, mas é filtro também — entra no badge.
  const filterCount = activeFilterCount(filters) + (state.client ? 1 : 0);

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
        cell: ({ row }) => <BatchCell batches={row.original.batches} />,
      },
      {
        // accessorFn (não accessorKey): a maioria das orders vem sem esse campo,
        // e o sort automático do TanStack não trata null.
        id: "operational_responsible",
        accessorFn: (r) => r.operational_responsible ?? "",
        header: ({ column }) => (
          <SortableHeader label="Operational Responsible" column={column} />
        ),
        cell: ({ row }) => row.original.operational_responsible ?? dash,
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
        cell: ({ row }) => (
          <StatusPill label={ORDER_STATUS_LABELS[row.original.status]} />
        ),
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
            <DeleteOrderButton
              status={row.original.status}
              onDelete={() => setDeleteTarget(row.original)}
            />
          </div>
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
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Orders
          </h1>
          <p className="text-sm text-muted-foreground">Orders management</p>
        </div>
        {/* Sem "Create Order": quem cria order é o GSS, pela API (19/10/2026).
            Sem "Download XLS": a exportação foi cortada de todo o sistema,
            exceto ETD Factories, Pre-loading e Shipments (docs §11). */}
      </div>

      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="PO number"
        activeCount={filterCount}
        controls={(close) => (
          <>
            <Select
              value={state.client || "all"}
              onValueChange={(v) => navigate({ ...state, client: v === "all" ? "" : v, page: 1 })}
            >
              <SelectTrigger className="!h-11 rounded-xl bg-white min-[720px]:w-60">
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
        keep={list.keep}
        onKeepChange={list.setKeep}
        orderTypes={orderTypes}
        businessUnits={businessUnits}
        exporters={exporters}
        profiles={profiles}
        operationalUsers={operationalUsers}
      />

      {/* Cards só no mobile real (<720px); de 720 pra cima assume a tabela.
          O breakpoint casa com o `min-[720px]:block` da <Table> abaixo e com o
          corte da <ListToolbar>. Decisão do Henrique em 12/08/2026. */}
      <div className={navigating ? "pointer-events-none opacity-60 transition-opacity" : undefined}>
      <DataCards
        rows={table.getRowModel().rows}
        labels={CARD_LABELS}
        titleColumnId="po_number"
        headerColumnIds={["status", "actions"]}
        emptyMessage="No orders found."
        breakpoint="720"
        onRowClick={(row) => router.push(`/orders/${row.original.po_number}`)}
      />

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
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-slate-50/60"
                  onClick={() => router.push(`/orders/${row.original.po_number}`)}
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
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Page {state.page} of {pageCount}
          <span className="ml-2 text-slate-400">· {total} orders</span>
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

      <OrderFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        orderTypes={orderTypes}
        clients={clients}
        businessUnits={businessUnits}
        exporters={exporters}
        profiles={profiles}
        operationalUsers={operationalUsers}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete order?"
        description={
          deleteTarget
            ? `Order ${deleteTarget.po_number} will be permanently deleted, along with its batches and checklist.`
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
