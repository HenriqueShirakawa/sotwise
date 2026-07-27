"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Pencil, Trash2, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { formatDate } from "@/lib/format";
import { DataTable } from "@/components/data-table";
import { FormDrawer } from "@/components/form-drawer";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

import { createFactories, updateFactory, deleteFactory } from "./actions";

type Factory = { id: string; name: string; created_at: string };

export function FactoriesClient({ data }: { data: Factory[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Factory | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Factory | null>(null);

  const columns: ColumnDef<Factory>[] = [
    { accessorKey: "name", header: "Name" },
    {
      accessorKey: "created_at",
      header: "Created",
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
      const res = await deleteFactory(deleteTarget.id);
      if (res.ok) {
        toast.success("Factory deleted.");
        setDeleteTarget(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function handleCreate(names: string[]) {
    startTransition(async () => {
      const res = await createFactories(names);
      if (res.ok) {
        toast.success(names.length > 1 ? "Factories created." : "Factory created.");
        setDrawerOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function handleEdit(name: string) {
    if (!editing) return;
    startTransition(async () => {
      const res = await updateFactory(editing.id, name);
      if (res.ok) {
        toast.success("Factory updated.");
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
        searchPlaceholder="Search factories…"
        emptyMessage="No factories yet."
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
        title={editing ? "Edit factory" : "New factories"}
        description={editing ? undefined : "Add one or more factory names."}
      >
        <FactoryForm
          editing={editing}
          pending={pending}
          onCreate={handleCreate}
          onEdit={handleEdit}
        />
      </FormDrawer>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete factory?"
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

function FactoryForm({
  editing,
  pending,
  onCreate,
  onEdit,
}: {
  editing: Factory | null;
  pending: boolean;
  onCreate: (names: string[]) => void;
  onEdit: (name: string) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [names, setNames] = useState<string[]>([]);

  if (editing) {
    return (
      <form
        className="grid gap-4 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          onEdit(name.trim());
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
        <Button type="submit" disabled={pending || !name.trim()}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Save changes
        </Button>
      </form>
    );
  }

  function addName() {
    const value = name.trim();
    if (!value) return;
    setNames((prev) => (prev.includes(value) ? prev : [...prev, value]));
    setName("");
  }

  const totalToCreate = names.length + (name.trim() ? 1 : 0);

  return (
    <div className="grid gap-4 pt-2">
      <div className="grid gap-2">
        <Label htmlFor="name">Name</Label>
        <div className="flex gap-2">
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addName();
              }
            }}
            placeholder="Factory name"
            autoFocus
          />
          <Button
            type="button"
            variant="secondary"
            onClick={addName}
            disabled={!name.trim()}
          >
            Add
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Press Enter or Add to queue multiple factories.
        </p>
      </div>

      {names.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {names.map((n) => (
            <Badge key={n} variant="secondary" className="gap-1">
              {n}
              <button
                type="button"
                aria-label={`Remove ${n}`}
                onClick={() => setNames((prev) => prev.filter((x) => x !== n))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}

      <Button
        type="button"
        disabled={pending || totalToCreate === 0}
        onClick={() => {
          const all = name.trim() ? [...names, name.trim()] : names;
          const unique = Array.from(new Set(all));
          if (unique.length) onCreate(unique);
        }}
      >
        {pending ? <Loader2 className="animate-spin" /> : null}
        Create{totalToCreate > 1 ? ` (${totalToCreate})` : ""}
      </Button>
    </div>
  );
}
