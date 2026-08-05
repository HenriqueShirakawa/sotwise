"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import {
  RegistrationTable,
  RowActions,
  sortableHeader,
} from "@/components/registration/registration-table";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SearchSelect } from "@/components/search-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { createClientRecord, updateClientRecord, deleteClientRecord } from "./actions";

type Option = { id: string; name: string };

export type ClientRow = {
  id: string;
  name: string;
  country_id: string | null;
  country_name: string | null;
  counts: {
    total: number;
    in_negotiation: number;
    in_production: number;
    shipped: number;
    delivered: number;
    canceled: number;
  };
};

/** Colunas de contagem, na ordem da tela do Bubble. */
const COUNT_COLUMNS: { key: keyof ClientRow["counts"]; label: string }[] = [
  { key: "total", label: "Total PO's" },
  { key: "in_negotiation", label: "PO's in negotiation" },
  { key: "in_production", label: "PO's in production" },
  { key: "shipped", label: "PO's shipped" },
  { key: "delivered", label: "PO's delivered" },
  { key: "canceled", label: "PO's canceled" },
];

export function ClientsClient({
  data,
  countries,
}: {
  data: ClientRow[];
  countries: Option[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [countrySearch, setCountrySearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClientRow | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const country = countrySearch.trim().toLowerCase();
    return data.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q)) return false;
      if (country && !(r.country_name ?? "").toLowerCase().includes(country)) return false;
      return true;
    });
  }, [data, search, countrySearch]);

  const columns = useMemo<ColumnDef<ClientRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: sortableHeader<ClientRow>("Client"),
        cell: ({ row }) => <span className="text-slate-800">{row.original.name}</span>,
      },
      {
        accessorKey: "country_name",
        header: sortableHeader<ClientRow>("Country"),
        cell: ({ row }) =>
          row.original.country_name ?? <span className="text-muted-foreground">—</span>,
      },
      ...COUNT_COLUMNS.map<ColumnDef<ClientRow>>(({ key, label }) => ({
        id: key,
        accessorFn: (row) => row.counts[key],
        header: sortableHeader<ClientRow>(label),
        cell: ({ row }) => <span className="text-slate-800">{row.original.counts[key]}</span>,
      })),
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions
            onEdit={() => {
              setEditing(row.original);
              setFormOpen(true);
            }}
            onDelete={() => setDeleteTarget(row.original)}
          />
        ),
      },
    ],
    []
  );

  function handleSubmit(values: { name: string; country_id: string }) {
    startTransition(async () => {
      const res = editing
        ? await updateClientRecord(editing.id, values)
        : await createClientRecord(values);
      if (res.ok) {
        toast.success(editing ? "Client updated." : "Client created.");
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
      const res = await deleteClientRecord(deleteTarget.id);
      if (res.ok) {
        toast.success("Client deleted.");
        setDeleteTarget(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <>
      <RegistrationTable
        title="Clients"
        subtitle="View, manage, and create new clients"
        createLabel="Create client"
        onCreate={() => {
          setEditing(null);
          setFormOpen(true);
        }}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Client's name"
        columns={columns}
        data={filtered}
        defaultSorting={[{ id: "name", desc: false }]}
        emptyMessage="No clients found."
        filters={
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={countrySearch}
              onChange={(e) => setCountrySearch(e.target.value)}
              placeholder="Country"
              className="h-11 rounded-xl bg-white pl-9"
            />
          </div>
        }
      />

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-primary">
              {editing ? "Edit client" : "Create client"}
            </DialogTitle>
          </DialogHeader>
          <ClientForm
            key={editing?.id ?? "new"}
            editing={editing}
            countries={countries}
            pending={pending}
            onCancel={() => setFormOpen(false)}
            onSubmit={handleSubmit}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete client?"
        description={
          deleteTarget ? `"${deleteTarget.name}" will be removed from listings.` : undefined
        }
        confirmLabel="Delete"
        destructive
        loading={pending}
        onConfirm={handleDelete}
      />
    </>
  );
}

function ClientForm({
  editing,
  countries,
  pending,
  onCancel,
  onSubmit,
}: {
  editing: ClientRow | null;
  countries: Option[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (values: { name: string; country_id: string }) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [countryId, setCountryId] = useState(editing?.country_id ?? "");

  const valid = !!name.trim() && !!countryId;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit({ name: name.trim(), country_id: countryId });
      }}
    >
      <p className="border-b pb-2 text-sm text-muted-foreground">Main information</p>

      <div className="space-y-1.5">
        <Label htmlFor="name">Client name</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Insert client name"
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <Label>Country</Label>
        <SearchSelect
          value={countryId}
          onChange={setCountryId}
          options={countries}
          placeholder="Select a country"
        />
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          className="sm:min-w-32"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" className="sm:min-w-32" disabled={pending || !valid}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {editing ? "Save" : "Create"}
        </Button>
      </DialogFooter>
    </form>
  );
}
