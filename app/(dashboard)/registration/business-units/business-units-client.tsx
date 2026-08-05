"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { ImageIcon, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import {
  RegistrationTable,
  RowActions,
  sortableHeader,
} from "@/components/registration/registration-table";
import { ConfirmDialog } from "@/components/confirm-dialog";
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

import { createBusinessUnit, updateBusinessUnit, deleteBusinessUnit } from "./actions";

export type BusinessUnitRow = {
  id: string;
  name: string;
  icon_path: string | null;
  icon_url: string | null;
};

export function BusinessUnitsClient({ data }: { data: BusinessUnitRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BusinessUnitRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BusinessUnitRow | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter((r) => r.name.toLowerCase().includes(q));
  }, [data, search]);

  const columns = useMemo<ColumnDef<BusinessUnitRow>[]>(
    () => [
      {
        id: "icon",
        header: "",
        enableSorting: false,
        cell: ({ row }) => <BusinessUnitIcon url={row.original.icon_url} />,
      },
      {
        accessorKey: "name",
        header: sortableHeader<BusinessUnitRow>("Business Unit"),
        cell: ({ row }) => <span className="text-slate-800">{row.original.name}</span>,
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions
            align="start"
            containerClassName="w-[200px]"
            tooltips
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

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = editing
        ? await updateBusinessUnit(editing.id, formData)
        : await createBusinessUnit(formData);
      if (res.ok) {
        toast.success(editing ? "Business unit updated." : "Business unit created.");
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
      const res = await deleteBusinessUnit(deleteTarget.id);
      if (res.ok) {
        toast.success("Business unit deleted.");
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
        title="Business Unit"
        subtitle="View, manage, and create new business units"
        createLabel="Create new business unit"
        onCreate={() => {
          setEditing(null);
          setFormOpen(true);
        }}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Business unit name"
        columns={columns}
        data={filtered}
        defaultSorting={[{ id: "name", desc: false }]}
        cardTitleColumnId="name"
        cardHeaderColumnIds={["icon", "actions"]}
        emptyMessage="No business units found."
      />

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-primary">
              {editing ? "Edit business unit" : "Create business unit"}
            </DialogTitle>
          </DialogHeader>
          <BusinessUnitForm
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
        title="Delete business unit?"
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

function BusinessUnitIcon({ url, className = "" }: { url: string | null; className?: string }) {
  if (!url) {
    return (
      <div
        className={`flex size-10 items-center justify-center rounded-lg bg-slate-100 text-slate-400 ${className}`}
      >
        <ImageIcon className="size-4" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- URL assinada do Storage, fora do loader do next/image
    <img
      src={url}
      alt=""
      className={`size-10 rounded-lg border bg-white object-contain p-1 ${className}`}
    />
  );
}

function BusinessUnitForm({
  editing,
  pending,
  onCancel,
  onSubmit,
}: {
  editing: BusinessUnitRow | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (formData: FormData) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  /** Arquivo + preview local juntos: a URL nasce no onChange e morre no cleanup. */
  const [picked, setPicked] = useState<{ file: File; url: string } | null>(null);

  useEffect(() => {
    if (!picked) return;
    return () => URL.revokeObjectURL(picked.url);
  }, [picked]);

  const file = picked?.file ?? null;
  const valid = !!name.trim() && (!!file || !!editing?.icon_path);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        const formData = new FormData();
        formData.set("name", name.trim());
        if (file) formData.set("icon", file);
        onSubmit(formData);
      }}
    >
      <p className="border-b pb-2 text-sm text-muted-foreground">Main information</p>

      <div className="space-y-1.5">
        <Label htmlFor="name">Business unit name</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Insert business unit name"
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="icon">Image</Label>
        <div className="flex items-center gap-3">
          <BusinessUnitIcon url={picked?.url ?? editing?.icon_url ?? null} className="size-14" />
          <div className="flex-1">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => document.getElementById("icon")?.click()}
            >
              <Upload />
              {file ? "Change image" : editing?.icon_path ? "Replace image" : "Select image"}
            </Button>
            <input
              id="icon"
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              className="sr-only"
              onChange={(e) => {
                const selected = e.target.files?.[0];
                setPicked(
                  selected ? { file: selected, url: URL.createObjectURL(selected) } : null
                );
              }}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              {file ? file.name : "PNG, JPEG or SVG · up to 5MB"}
            </p>
          </div>
        </div>
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
