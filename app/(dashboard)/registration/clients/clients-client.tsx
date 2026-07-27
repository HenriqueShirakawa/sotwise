"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { formatDate } from "@/lib/format";
import { DataTable } from "@/components/data-table";
import { FormDrawer } from "@/components/form-drawer";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  createClientRecord,
  updateClientRecord,
  deleteClientRecord,
} from "./actions";

type Country = { id: string; name: string };
type ClientRow = {
  id: string;
  name: string;
  country_id: string | null;
  created_at: string;
  country_name: string | null;
};

export function ClientsClient({
  data,
  countries,
}: {
  data: ClientRow[];
  countries: Country[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClientRow | null>(null);

  const columns: ColumnDef<ClientRow>[] = [
    { accessorKey: "name", header: "Name" },
    {
      accessorKey: "country_name",
      header: "Country",
      cell: ({ row }) =>
        row.original.country_name ?? (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      accessorKey: "created_at",
      header: "Created",
      enableGlobalFilter: false,
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {formatDate(row.original.created_at)}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      enableGlobalFilter: false,
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Edit"
            onClick={() => {
              setEditing(row.original);
              setDrawerOpen(true);
            }}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete"
            onClick={() => setDeleteTarget(row.original)}
          >
            <Trash2 />
          </Button>
        </div>
      ),
    },
  ];

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

  function handleSubmit(values: { name: string; country_id: string }) {
    startTransition(async () => {
      const res = editing
        ? await updateClientRecord(editing.id, values)
        : await createClientRecord(values);
      if (res.ok) {
        toast.success(editing ? "Client updated." : "Client created.");
        setDrawerOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        searchPlaceholder="Search clients…"
        emptyMessage="No clients yet."
        toolbar={
          <Button
            onClick={() => {
              setEditing(null);
              setDrawerOpen(true);
            }}
          >
            <Plus />
            New
          </Button>
        }
      />

      <FormDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title={editing ? "Edit client" : "New client"}
      >
        <ClientForm
          editing={editing}
          countries={countries}
          pending={pending}
          onSubmit={handleSubmit}
        />
      </FormDrawer>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete client?"
        description={
          deleteTarget
            ? `"${deleteTarget.name}" will be removed from listings.`
            : undefined
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
  onSubmit,
}: {
  editing: ClientRow | null;
  countries: Country[];
  pending: boolean;
  onSubmit: (values: { name: string; country_id: string }) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [countryId, setCountryId] = useState(editing?.country_id ?? "");

  const valid = name.trim().length > 0 && countryId.length > 0;

  return (
    <form
      className="grid gap-4 pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit({ name: name.trim(), country_id: countryId });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="country">Country</Label>
        <Select value={countryId} onValueChange={setCountryId}>
          <SelectTrigger id="country" className="w-full">
            <SelectValue placeholder="Select a country" />
          </SelectTrigger>
          <SelectContent>
            {countries.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button type="submit" disabled={pending || !valid}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        {editing ? "Save changes" : "Create client"}
      </Button>
    </form>
  );
}
