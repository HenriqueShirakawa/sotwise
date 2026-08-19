"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import type { AgentInput } from "@/domain/registration/schema";
import type { AgentLocation } from "@/types/database";
import {
  RegistrationTable,
  RowActions,
  sortableHeader,
} from "@/components/registration/registration-table";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SearchSelect } from "@/components/search-select";
import { MultiSearchSelect } from "@/components/multi-search-select";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { createAgent, updateAgent, deleteAgent } from "./actions";

type Option = { id: string; name: string };

export type AgentRow = {
  id: string;
  name: string;
  country_id: string | null;
  country_name: string | null;
  location: AgentLocation | null;
  email: string | null;
  email_na: boolean;
  phone_number: string | null;
  contact_ids: string[];
  contact_names: string[];
};

const LOCATIONS: { value: AgentLocation; label: string }[] = [
  { value: "brazil", label: "Brazil" },
  { value: "china", label: "China" },
];

const locationLabel = (l: AgentLocation | null) =>
  LOCATIONS.find((o) => o.value === l)?.label ?? null;

export function AgentsClient({
  data,
  countries,
  contacts,
}: {
  data: AgentRow[];
  countries: Option[];
  contacts: Option[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState<"all" | AgentLocation>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AgentRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AgentRow | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.filter((r) => {
      if (location !== "all" && r.location !== location) return false;
      if (!q) return true;
      return [r.name, r.email ?? "", r.phone_number ?? "", r.country_name ?? ""].some((v) =>
        v.toLowerCase().includes(q)
      );
    });
  }, [data, search, location]);

  const columns = useMemo<ColumnDef<AgentRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: sortableHeader<AgentRow>("Agent"),
        cell: ({ row }) => <span className="text-slate-800">{row.original.name}</span>,
      },
      {
        accessorKey: "country_name",
        header: sortableHeader<AgentRow>("Country"),
        cell: ({ row }) =>
          row.original.country_name ?? <span className="text-muted-foreground">—</span>,
      },
      {
        accessorKey: "location",
        header: "Location",
        enableSorting: false,
        cell: ({ row }) => {
          const label = locationLabel(row.original.location);
          return label ? (
            <Badge variant="secondary">{label}</Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      },
      {
        accessorKey: "email",
        header: "E-mail",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.email ?? <span className="text-muted-foreground">N/A</span>,
      },
      {
        accessorKey: "phone_number",
        header: "Phone number",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.phone_number ?? <span className="text-muted-foreground">—</span>,
      },
      {
        id: "contacts",
        header: "Contacts",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.contact_names.length ? (
            <span className="text-slate-800">{row.original.contact_names.join(", ")}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
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

  function handleSubmit(values: AgentInput) {
    startTransition(async () => {
      const res = editing ? await updateAgent(editing.id, values) : await createAgent(values);
      if (res.ok) {
        toast.success(editing ? "Agent updated." : "Agent created.");
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
      const res = await deleteAgent(deleteTarget.id);
      if (res.ok) {
        toast.success("Agent deleted.");
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
        title="Agents"
        subtitle="View, manage, and create new logistics agents"
        createLabel="Create new agent"
        onCreate={() => {
          setEditing(null);
          setFormOpen(true);
        }}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Agent name, country, e-mail or phone"
        columns={columns}
        data={filtered}
        defaultSorting={[{ id: "name", desc: false }]}
        emptyMessage="No agents found."
        filters={
          <Select
            value={location}
            onValueChange={(v) => setLocation(v as "all" | AgentLocation)}
          >
            <SelectTrigger className="!h-11 w-44 rounded-xl bg-white">
              <SelectValue placeholder="Location" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All locations</SelectItem>
              {LOCATIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-primary">
              {editing ? "Edit agent" : "Create agent"}
            </DialogTitle>
          </DialogHeader>
          <AgentForm
            key={editing?.id ?? "new"}
            editing={editing}
            countries={countries}
            contacts={contacts}
            pending={pending}
            onCancel={() => setFormOpen(false)}
            onSubmit={handleSubmit}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete agent?"
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

function AgentForm({
  editing,
  countries,
  contacts,
  pending,
  onCancel,
  onSubmit,
}: {
  editing: AgentRow | null;
  countries: Option[];
  contacts: Option[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (values: AgentInput) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [countryId, setCountryId] = useState(editing?.country_id ?? "");
  const [location, setLocation] = useState<AgentLocation | "">(editing?.location ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [emailNa, setEmailNa] = useState(editing?.email_na ?? false);
  const [phone, setPhone] = useState(editing?.phone_number ?? "");
  const [contactIds, setContactIds] = useState<string[]>(editing?.contact_ids ?? []);

  const valid =
    !!name.trim() &&
    !!countryId &&
    !!location &&
    !!phone.trim() &&
    (emailNa || !!email.trim());

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || !location) return;
        onSubmit({
          name: name.trim(),
          country_id: countryId,
          location,
          email: emailNa ? null : email.trim(),
          email_na: emailNa,
          phone_number: phone.trim(),
          contact_ids: contactIds,
        });
      }}
    >
      <p className="border-b pb-2 text-sm text-muted-foreground">Main information</p>

      <div className="space-y-1.5">
        <Label htmlFor="name" required>
          Agent name
        </Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Insert agent name"
          autoFocus
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label required>Country</Label>
          <SearchSelect
            value={countryId}
            onChange={setCountryId}
            options={countries}
            placeholder="Select a country"
          />
        </div>
        <div className="space-y-1.5">
          <Label required>Location</Label>
          <Select value={location} onValueChange={(v) => setLocation(v as AgentLocation)}>
            {/* Sem override de altura: o h-8 padrão do SelectTrigger é o mesmo
                do SearchSelect de Country ao lado, e o do Input. */}
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a location" />
            </SelectTrigger>
            <SelectContent>
              {LOCATIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          {/* Obrigatório só enquanto "No e-mail (N/A)" está desmarcado. */}
          <Label htmlFor="email" required={!emailNa}>
            E-mail
          </Label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <Checkbox checked={emailNa} onCheckedChange={(c) => setEmailNa(c === true)} />
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

      <div className="space-y-1.5">
        <Label>Linked contacts</Label>
        <MultiSearchSelect
          value={contactIds}
          onChange={setContactIds}
          options={contacts}
          placeholder="Choose some contacts..."
        />
        <p className="text-xs text-muted-foreground">
          These are the contacts offered as Contact Brazil / Contact China in Pre-loading.
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
