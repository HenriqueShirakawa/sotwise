"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import type { ContactInput } from "@/domain/registration/schema";
import {
  RegistrationTable,
  RowActions,
  sortableHeader,
} from "@/components/registration/registration-table";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { createContact, updateContact, deleteContact } from "./actions";

export type ContactRow = {
  id: string;
  name: string;
  email: string | null;
  email_na: boolean;
  phone_number: string;
};

export function ContactsClient({ data }: { data: ContactRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ContactRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContactRow | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter((r) =>
      [r.name, r.email ?? "", r.phone_number].some((v) => v.toLowerCase().includes(q))
    );
  }, [data, search]);

  const columns = useMemo<ColumnDef<ContactRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: sortableHeader<ContactRow>("Name"),
        cell: ({ row }) => <span className="text-slate-800">{row.original.name}</span>,
      },
      {
        accessorKey: "email",
        header: sortableHeader<ContactRow>("E-mail"),
        cell: ({ row }) =>
          row.original.email ?? <span className="text-muted-foreground">N/A</span>,
      },
      {
        accessorKey: "phone_number",
        header: "Phone number",
        enableSorting: false,
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

  function handleSubmit(values: ContactInput) {
    startTransition(async () => {
      const res = editing
        ? await updateContact(editing.id, values)
        : await createContact(values);
      if (res.ok) {
        toast.success(editing ? "Contact updated." : "Contact created.");
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
      const res = await deleteContact(deleteTarget.id);
      if (res.ok) {
        toast.success("Contact deleted.");
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
        title="Contacts"
        subtitle="View, manage, and create new contacts"
        createLabel="Create new contact"
        onCreate={() => {
          setEditing(null);
          setFormOpen(true);
        }}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Contact name, e-mail or phone"
        columns={columns}
        data={filtered}
        defaultSorting={[{ id: "name", desc: false }]}
        emptyMessage="No contacts found."
      />

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-primary">
              {editing ? "Edit contact" : "Create contact"}
            </DialogTitle>
          </DialogHeader>
          <ContactForm
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
        title="Delete contact?"
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

function ContactForm({
  editing,
  pending,
  onCancel,
  onSubmit,
}: {
  editing: ContactRow | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (values: ContactInput) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [emailNa, setEmailNa] = useState(editing?.email_na ?? false);
  const [phone, setPhone] = useState(editing?.phone_number ?? "");

  const valid = !!name.trim() && !!phone.trim() && (emailNa || !!email.trim());

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSubmit({
          name: name.trim(),
          email: emailNa ? null : email.trim(),
          email_na: emailNa,
          phone_number: phone.trim(),
        });
      }}
    >
      <p className="border-b pb-2 text-sm text-muted-foreground">Main information</p>

      <div className="space-y-1.5">
        <Label htmlFor="name" required>
          Contact name
        </Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Insert contact name"
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          {/* Obrigatório só enquanto "No e-mail (N/A)" está desmarcado. */}
          <Label htmlFor="email" required={!emailNa}>
            E-mail
          </Label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={emailNa}
              onCheckedChange={(c) => setEmailNa(c === true)}
            />
            No e-mail (N/A)
          </label>
        </div>
        <Input
          id="email"
          type="email"
          value={emailNa ? "" : email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={emailNa ? "N/A" : "Insert e-mail"}
          disabled={emailNa}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="phone" required>
          Phone number
        </Label>
        <Input
          id="phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Insert phone number"
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
