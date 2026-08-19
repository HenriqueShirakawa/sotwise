"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import type { CategoryFormInput } from "@/domain/registration/schema";
import {
  RegistrationTable,
  RowActions,
  sortableHeader,
} from "@/components/registration/registration-table";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MultiSearchSelect } from "@/components/multi-search-select";
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

import { createCategory, updateCategory, deleteCategory } from "./actions";

type Option = { id: string; name: string };

export type CategoryRow = {
  id: string;
  name: string;
  factory_ids: string[];
  factory_names: string[];
};

export function CategoriesClient({
  data,
  factories,
}: {
  data: CategoryRow[];
  factories: Option[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CategoryRow | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    // Busca também pelo nome da fábrica: "que categorias a Dajin atende?" é a
    // pergunta natural nesta tela, e sem isto ela não tem resposta.
    return data.filter((r) =>
      [r.name, ...r.factory_names].some((v) => v.toLowerCase().includes(q))
    );
  }, [data, search]);

  const columns = useMemo<ColumnDef<CategoryRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: sortableHeader<CategoryRow>("Category"),
        cell: ({ row }) => <span className="text-slate-800">{row.original.name}</span>,
      },
      {
        id: "factories",
        header: "Linked factories",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.factory_names.length ? (
            <span className="text-slate-800">{row.original.factory_names.join(", ")}</span>
          ) : (
            // Categoria sem fábrica não deveria existir (a regra é ≥ 1), mas a
            // base migrada do Bubble pode ter — sinaliza em vez de mostrar "—".
            <span className="text-amber-700">No factory linked</span>
          ),
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

  function handleSubmit(values: CategoryFormInput) {
    startTransition(async () => {
      const res = editing
        ? await updateCategory(editing.id, values)
        : await createCategory(values);
      if (res.ok) {
        toast.success(editing ? "Category updated." : "Category created.");
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
      const res = await deleteCategory(deleteTarget.id);
      if (res.ok) {
        toast.success("Category deleted.");
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
        title="Categories"
        subtitle="View, manage, and create the categories linked to each factory"
        createLabel="Create new category"
        onCreate={() => {
          setEditing(null);
          setFormOpen(true);
        }}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Category or factory name"
        columns={columns}
        data={filtered}
        defaultSorting={[{ id: "name", desc: false }]}
        cardHeaderColumnIds={["actions"]}
        cardBreakpoint="720"
        emptyMessage="No categories found."
      />

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-primary">
              {editing ? "Edit category" : "Create category"}
            </DialogTitle>
          </DialogHeader>
          <CategoryForm
            key={editing?.id ?? "new"}
            editing={editing}
            factories={factories}
            pending={pending}
            onCancel={() => setFormOpen(false)}
            onSubmit={handleSubmit}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete category?"
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

function CategoryForm({
  editing,
  factories,
  pending,
  onCancel,
  onSubmit,
}: {
  editing: CategoryRow | null;
  factories: Option[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (values: CategoryFormInput) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [factoryIds, setFactoryIds] = useState<string[]>(editing?.factory_ids ?? []);

  // ≥ 1 fábrica é regra de negócio (§3.5.2), não preferência de UI: uma
  // categoria sem fábrica não pode virar entrada Factory × Category nenhuma.
  const valid = !!name.trim() && factoryIds.length > 0;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSubmit({ name: name.trim(), factory_ids: factoryIds });
      }}
    >
      <p className="border-b pb-2 text-sm text-muted-foreground">Main information</p>

      <div className="space-y-1.5">
        <Label htmlFor="name">Category</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Insert category name"
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <Label>Linked factories</Label>
        <MultiSearchSelect
          value={factoryIds}
          onChange={setFactoryIds}
          options={factories}
          placeholder="Choose some factories..."
        />
        <p className="text-xs text-muted-foreground">
          A category can span several factories. At least one is required — Factory ×
          Category is what orders, batches and checklists hang from.
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
