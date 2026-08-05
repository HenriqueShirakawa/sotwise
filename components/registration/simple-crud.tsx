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
import { Search, Plus, Pencil, Trash2, ChevronLeft, ChevronRight, ArrowUpDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import type { ActionResult } from "@/domain/registration/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataCards } from "@/components/data-cards";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type SimpleRow = { id: string; name: string };

/**
 * Tela de CRUD para os cadastros "name-only" (Carriers, POL, POD, Countries,
 * Order Type, Shipment Models). Modal centralizado (fiel ao Bubble); as três
 * server actions chegam por prop, então o mesmo componente serve todas as telas.
 */
export function SimpleRegistrationCrud({
  data,
  title,
  subtitle,
  singular,
  columnLabel,
  searchPlaceholder,
  createLabel,
  createAction,
  updateAction,
  deleteAction,
}: {
  data: SimpleRow[];
  title: string;
  subtitle: string;
  /** Nome no singular, minúsculo — usado nos toasts/diálogos (ex.: "carrier"). */
  singular: string;
  /** Cabeçalho da coluna de nome (ex.: "Carrier"). */
  columnLabel: string;
  searchPlaceholder: string;
  createLabel: string;
  createAction: (names: string[]) => Promise<ActionResult>;
  updateAction: (id: string, name: string) => Promise<ActionResult>;
  deleteAction: (id: string) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SimpleRow | null>(null);
  const [name, setName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SimpleRow | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter((r) => r.name.toLowerCase().includes(q));
  }, [data, search]);

  function openCreate() {
    setEditing(null);
    setName("");
    setFormOpen(true);
  }
  function openEdit(row: SimpleRow) {
    setEditing(row);
    setName(row.name);
    setFormOpen(true);
  }

  function submit() {
    const value = name.trim();
    if (!value) return;
    startTransition(async () => {
      const res = editing
        ? await updateAction(editing.id, value)
        : await createAction([value]);
      if (res.ok) {
        toast.success(editing ? `${cap(singular)} updated.` : `${cap(singular)} created.`);
        setFormOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function handleDelete() {
    if (!deleteTarget) return;
    startTransition(async () => {
      const res = await deleteAction(deleteTarget.id);
      if (res.ok) {
        toast.success(`${cap(singular)} deleted.`);
        setDeleteTarget(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  const columns = useMemo<ColumnDef<SimpleRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader label={columnLabel} column={column} />,
        cell: ({ row }) => <span className="text-slate-800">{row.original.name}</span>,
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-slate-500 hover:text-primary"
              aria-label="Edit"
              onClick={() => openEdit(row.original)}
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-slate-500 hover:text-destructive"
              aria-label="Delete"
              onClick={() => setDeleteTarget(row.original)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ),
      },
    ],
    [columnLabel]
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
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Button className="h-11 w-full rounded-xl px-5 sm:w-auto" onClick={openCreate}>
          <Plus />
          {createLabel}
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-11 rounded-xl bg-white pl-9"
          />
        </div>
      </div>

      <DataCards
        rows={table.getRowModel().rows}
        labels={{ name: columnLabel }}
        emptyMessage="No records found."
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
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
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
                  No records found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Page {pageIndex + 1} of {Math.max(table.getPageCount(), 1)} · Total: {filtered.length}{" "}
          records
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

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-primary">
              {editing ? `Edit ${singular}` : `Create ${singular}`}
            </DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <p className="border-b pb-2 text-sm text-muted-foreground">Main information</p>
            <div className="space-y-1.5">
              <Label htmlFor="name">{columnLabel} name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`Insert ${singular} name`}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="sm:min-w-32"
                onClick={() => setFormOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" className="sm:min-w-32" disabled={pending || !name.trim()}>
                {pending ? <Loader2 className="animate-spin" /> : null}
                {editing ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Delete ${singular}?`}
        description={
          deleteTarget ? `"${deleteTarget.name}" will be removed from listings.` : undefined
        }
        confirmLabel="Delete"
        destructive
        loading={pending}
        onConfirm={handleDelete}
      />
    </div>
  );
}

function SortableHeader({ label, column }: { label: string; column: Column<SimpleRow, unknown> }) {
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

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
