"use client";

import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { Mail, User } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDateTime, companyTimeZone } from "@/lib/format";
import type { EmailListRow, EmailRecordGroup } from "@/lib/checklist-emails-list-actions";
import type { StepEmailRecipient, StepEmailStatus } from "@/types/database";
import { DataCards, labelsFromOptions } from "@/components/data-cards";
import { ListToolbar } from "@/components/list-toolbar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const GROUP_LABEL: Record<EmailRecordGroup, string> = { po: "PO", pl: "PL" };

const STATUS_STYLE: Record<StepEmailStatus, { label: string; className: string }> = {
  success: { label: "Sent", className: "bg-emerald-50 text-emerald-700" },
  partial: { label: "Partial", className: "bg-amber-50 text-amber-700" },
  failed: { label: "Failed", className: "bg-rose-50 text-rose-700" },
};

function StatusBadge({ status }: { status: StepEmailStatus | null }) {
  const s = status ? STATUS_STYLE[status] : null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        s ? s.className : "bg-slate-100 text-slate-500"
      )}
    >
      {s ? s.label : "—"}
    </span>
  );
}

function RecipientChips({ recipients }: { recipients: StepEmailRecipient[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {recipients.map((r) => (
        <span
          key={r.user_id}
          title={r.error ?? undefined}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap",
            r.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
          )}
        >
          <User className="size-3" />
          {r.name}
        </span>
      ))}
    </div>
  );
}

/** Fábrica das colunas — "Sent at" fecha sobre `timeZone` (fuso da company do
 *  usuário logado, ver `companyTimeZone`), então precisa ser recriada se ele mudar. */
function buildColumns(timeZone: string): ColumnDef<EmailListRow>[] {
  return [
    {
      id: "record",
      header: "Record",
      cell: ({ row }) => (
        <span className="font-mono text-sm text-slate-800">
          {GROUP_LABEL[row.original.group]} {row.original.number}
        </span>
      ),
    },
    {
      id: "clients",
      header: "Client",
      cell: ({ row }) => row.original.clients ?? "—",
    },
    {
      id: "subject",
      header: "Subject",
      cell: ({ row }) => <span className="break-words">{row.original.subject}</span>,
    },
    {
      id: "sender_name",
      header: "Sender",
      cell: ({ row }) => row.original.sender_name,
    },
    {
      id: "recipients",
      header: "Recipients",
      cell: ({ row }) => <RecipientChips recipients={row.original.recipients} />,
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "created_at",
      header: "Sent at",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-slate-600">
          {formatDateTime(row.original.created_at, timeZone)}
        </span>
      ),
    },
  ];
}

const COLUMN_LABELS = labelsFromOptions([
  { id: "record", label: "Record" },
  { id: "clients", label: "Client" },
  { id: "subject", label: "Subject" },
  { id: "sender_name", label: "Sender" },
  { id: "recipients", label: "Recipients" },
  { id: "status", label: "Status" },
  { id: "created_at", label: "Sent at" },
]);

/**
 * Histórico de e-mails de checklist (Fase 2.1 US3), lista no mesmo padrão
 * visual das outras listas do app (Orders/To do) — tabela ≥720px, cards
 * abaixo disso (`DataCards`, breakpoint "720", mesma régua de
 * responsividade-listas-cards já usada nas 6 listas migradas).
 */
export function EmailsClient({
  rows,
  company,
}: {
  rows: EmailListRow[];
  company: "BR" | "China";
}) {
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<EmailRecordGroup | "any">("any");
  const timeZone = companyTimeZone(company);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (group !== "any" && r.group !== group) return false;
      if (!q) return true;
      return (
        r.subject.toLowerCase().includes(q) ||
        r.number.toLowerCase().includes(q) ||
        (r.clients ?? "").toLowerCase().includes(q) ||
        r.sender_name.toLowerCase().includes(q) ||
        r.recipients.some((rec) => rec.name.toLowerCase().includes(q))
      );
    });
  }, [rows, search, group]);

  const columns = useMemo(() => buildColumns(timeZone), [timeZone]);

  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <Mail className="size-5 text-primary" />
        <h1 className="text-lg font-semibold text-slate-900">Emails</h1>
      </div>

      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search by PO/PL, subject, client, or person..."
        controls={() => (
          <Select value={group} onValueChange={(v) => setGroup(v as EmailRecordGroup | "any")}>
            <SelectTrigger className="!h-10 w-full bg-white min-[720px]:w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any type</SelectItem>
              <SelectItem value="po">PO</SelectItem>
              <SelectItem value="pl">PL</SelectItem>
            </SelectContent>
          </Select>
        )}
      />

      <div className="hidden overflow-x-auto rounded-2xl border bg-white min-[720px]:block">
        <Table>
          <TableHeader>
            <TableRow>
              {table.getFlatHeaders().map((header) => (
                <TableHead key={header.id}>
                  {typeof header.column.columnDef.header === "string"
                    ? header.column.columnDef.header
                    : null}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-8 text-center text-muted-foreground">
                  No emails sent yet.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <DataCards
        rows={table.getRowModel().rows}
        labels={COLUMN_LABELS}
        titleColumnId="record"
        headerColumnIds={["status"]}
        emptyMessage="No emails sent yet."
        breakpoint="720"
      />
    </div>
  );
}
