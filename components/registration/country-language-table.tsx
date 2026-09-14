"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
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
import { Search, ArrowUpDown, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import type { ActionResult } from "@/domain/registration/schema";
import type { EmailLanguage } from "@/lib/email/checklist-step";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataCards } from "@/components/data-cards";
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

export type CountryLanguageRow = {
  id: string;
  name: string;
  language: EmailLanguage | null;
};

const LANGUAGE_LABELS: Record<EmailLanguage, string> = {
  "pt-BR": "Portuguese (BR)",
  en: "English",
  zh: "Chinese",
};

const NONE = "__none__";

/**
 * Fallback de idioma por país (Fase 2.1, RN02/RN03) — usado só quando o
 * cliente não tem `language` próprio. Salva a cada troca de select, sem modal:
 * é edição de uma tabela de referência, não um cadastro com criação/exclusão.
 */
export function CountryLanguageTable({
  data,
  updateAction,
}: {
  data: CountryLanguageRow[];
  updateAction: (countryId: string, language: EmailLanguage | null) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter((r) => r.name.toLowerCase().includes(q));
  }, [data, search]);

  const handleChange = useCallback(
    (row: CountryLanguageRow, value: string) => {
      const language = value === NONE ? null : (value as EmailLanguage);
      setPendingId(row.id);
      startTransition(async () => {
        const res = await updateAction(row.id, language);
        setPendingId(null);
        if (res.ok) {
          toast.success(`${row.name} updated.`);
          router.refresh();
        } else {
          toast.error(res.error);
        }
      });
    },
    [updateAction, router]
  );

  const columns = useMemo<ColumnDef<CountryLanguageRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader label="Country" column={column} />,
        cell: ({ row }) => <span className="text-slate-800">{row.original.name}</span>,
      },
      {
        id: "language",
        accessorFn: (row) => row.language ?? "",
        header: "Default language",
        enableSorting: false,
        cell: ({ row }) => (
          <Select
            value={row.original.language ?? NONE}
            onValueChange={(v) => handleChange(row.original, v)}
            disabled={pendingId === row.original.id}
          >
            <SelectTrigger className="!h-9 w-full bg-white sm:w-48">
              {pendingId === row.original.id ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <SelectValue placeholder="No default" />
              )}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No default</SelectItem>
              <SelectItem value="pt-BR">{LANGUAGE_LABELS["pt-BR"]}</SelectItem>
              <SelectItem value="en">{LANGUAGE_LABELS.en}</SelectItem>
              <SelectItem value="zh">{LANGUAGE_LABELS.zh}</SelectItem>
            </SelectContent>
          </Select>
        ),
      },
    ],
    [pendingId, handleChange]
  );

  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
    initialState: { pagination: { pageSize: 20 } },
  });

  const pageIndex = table.getState().pagination.pageIndex;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Country Languages
        </h1>
        <p className="text-sm text-muted-foreground">
          Default e-mail language by country — used when a client has no language of their own.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Country name"
            className="h-11 rounded-xl bg-white pl-9"
          />
        </div>
      </div>

      <DataCards
        rows={table.getRowModel().rows}
        labels={{ name: "Country", language: "Default language" }}
        emptyMessage="No countries found."
      />

      <div className="hidden overflow-x-auto rounded-2xl border bg-white lg:block">
        <Table className="[&_td]:py-3 [&_th]:py-3.5">
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
                  No countries found.
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
    </div>
  );
}

function SortableHeader({
  label,
  column,
}: {
  label: string;
  column: Column<CountryLanguageRow, unknown>;
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
