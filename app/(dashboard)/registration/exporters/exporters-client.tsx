"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import type { ExporterInput } from "@/domain/registration/schema";
import {
  RegistrationTable,
  RowActions,
  sortableHeader,
} from "@/components/registration/registration-table";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
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

import { createExporter, updateExporter, deleteExporter } from "./actions";

export type ExporterRow = {
  id: string;
  name: string;
  acronym: string;
};

export function ExportersClient({ data }: { data: ExporterRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ExporterRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExporterRow | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter((r) =>
      [r.name, r.acronym].some((v) => v.toLowerCase().includes(q))
    );
  }, [data, search]);

  const columns = useMemo<ColumnDef<ExporterRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: sortableHeader<ExporterRow>("Exporter"),
        cell: ({ row }) => <span className="text-slate-800">{row.original.name}</span>,
      },
      {
        accessorKey: "acronym",
        header: "Acronym",
        enableSorting: false,
        // A sigla é o que aparece na lista de Orders (coluna Exporter usa
        // `acronym || name`) — por isso ganha destaque de badge aqui.
        cell: ({ row }) => <Badge variant="secondary">{row.original.acronym}</Badge>,
      },
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

  function handleSubmit(values: ExporterInput) {
    startTransition(async () => {
      const res = editing
        ? await updateExporter(editing.id, values)
        : await createExporter(values);
      if (res.ok) {
        toast.success(editing ? "Exporter updated." : "Exporter created.");
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
      const res = await deleteExporter(deleteTarget.id);
      if (res.ok) {
        toast.success("Exporter deleted.");
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
        title="Exporters"
        subtitle="View, manage, and create the exporting companies"
        createLabel="Create new exporter"
        onCreate={() => {
          setEditing(null);
          setFormOpen(true);
        }}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Exporter name or acronym"
        columns={columns}
        data={filtered}
        defaultSorting={[{ id: "name", desc: false }]}
        cardHeaderColumnIds={["actions"]}
        cardBreakpoint="720"
        emptyMessage="No exporters found."
      />

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-primary">
              {editing ? "Edit exporter" : "Create exporter"}
            </DialogTitle>
          </DialogHeader>
          <ExporterForm
            key={editing?.id ?? "new"}
            editing={editing}
            pending={pending}
            onCancel={() => setFormOpen(false)}
            onSubmit={handleSubmit}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete exporter?"
        description={
          deleteTarget
            ? `"${deleteTarget.name}" will be removed from listings. Orders already using it keep working.`
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

function ExporterForm({
  editing,
  pending,
  onCancel,
  onSubmit,
}: {
  editing: ExporterRow | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (values: ExporterInput) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [acronym, setAcronym] = useState(editing?.acronym ?? "");

  // Sigla é NOT NULL na base (init_schema.sql) — não dá para salvar sem.
  const valid = !!name.trim() && !!acronym.trim();

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSubmit({ name: name.trim(), acronym: acronym.trim() });
      }}
    >
      <p className="border-b pb-2 text-sm text-muted-foreground">Main information</p>

      <div className="space-y-1.5">
        <Label htmlFor="name">Exporter</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Insert exporter name"
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="acronym">Acronym</Label>
        <Input
          id="acronym"
          value={acronym}
          onChange={(e) => setAcronym(e.target.value)}
          placeholder="Insert acronym"
        />
        <p className="text-xs text-muted-foreground">
          Short form shown in the Orders list.
        </p>
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
