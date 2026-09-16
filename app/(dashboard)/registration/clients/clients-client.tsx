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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EmailLanguage } from "@/lib/email/checklist-step";

import {
  createClientRecord,
  updateClientRecord,
  deleteClientRecord,
  setClientUsers,
} from "./actions";

type Option = { id: string; name: string };

const LANGUAGE_LABELS: Record<EmailLanguage, string> = {
  "pt-BR": "Portuguese (BR)",
  en: "English",
  zh: "Chinese",
};
const USE_COUNTRY_DEFAULT = "__country_default__";

export type ClientRow = {
  id: string;
  name: string;
  country_id: string | null;
  country_name: string | null;
  /** Override manual do idioma do e-mail de checklist (Fase 2.1, RN01) —
   *  `null` segue o fallback por país (ver /registration/country-languages). */
  language: EmailLanguage | null;
  /** Usuários externos do cliente (papel `client`, ligados por client_id). */
  users: { name: string; blocked: boolean }[];
  counts: {
    total: number;
    in_negotiation: number;
    in_production: number;
    shipped: number;
    delivered: number;
    canceled: number;
  };
};

/** Opção do picker "Portal users" do modal — universo inteiro de usuários
 *  externos (papel `client`), não só os já ligados ao cliente em edição. */
export type PortalUserOption = {
  id: string;
  full_name: string;
  client_id: string | null;
  client_name: string | null;
  blocked: boolean;
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
  portalUsers,
}: {
  data: ClientRow[];
  countries: Option[];
  portalUsers: PortalUserOption[];
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
      // Busca casa com o nome do cliente OU de um usuário dele: "de que cliente
      // é a Fernanda?" é pergunta natural agora que a coluna existe.
      if (
        q &&
        ![r.name, ...r.users.map((u) => u.name)].some((v) => v.toLowerCase().includes(q))
      ) {
        return false;
      }
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
      {
        id: "language",
        accessorFn: (row) => row.language ?? "",
        header: sortableHeader<ClientRow>("Language"),
        cell: ({ row }) =>
          row.original.language ? (
            LANGUAGE_LABELS[row.original.language]
          ) : (
            <span className="text-muted-foreground" title="Follows the country default">
              — (country default)
            </span>
          ),
      },
      {
        id: "users",
        header: "Portal users",
        enableSorting: false,
        cell: ({ row }) => {
          const users = row.original.users;
          if (!users.length) {
            return <span className="text-muted-foreground">—</span>;
          }
          return (
            <span className="text-slate-800">
              {users.map((u, i) => (
                <span key={u.name + i}>
                  {i > 0 ? ", " : ""}
                  {/* Bloqueado aparece riscado: o vínculo existe, o acesso não. */}
                  <span
                    className={u.blocked ? "text-muted-foreground line-through" : undefined}
                    title={u.blocked ? "Access blocked" : undefined}
                  >
                    {u.name}
                  </span>
                </span>
              ))}
            </span>
          );
        },
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

  function handleSubmit(values: {
    name: string;
    country_id: string;
    language: EmailLanguage | null;
    user_ids: string[];
  }) {
    const { user_ids, ...clientValues } = values;
    startTransition(async () => {
      let clientId: string;
      if (editing) {
        const res = await updateClientRecord(editing.id, clientValues);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        clientId = editing.id;
      } else {
        const res = await createClientRecord(clientValues);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        clientId = res.id;
      }

      // Cliente já está salvo neste ponto — mesmo se a amarração de usuários
      // falhar, fechar e atualizar a lista é o estado real (nada de esconder
      // que metade da operação deu certo).
      const usersRes = await setClientUsers(clientId, user_ids);
      setFormOpen(false);
      router.refresh();
      if (usersRes.ok) {
        toast.success(editing ? "Client updated." : "Client created.");
      } else {
        toast.error(`Client saved, but linking users failed: ${usersRes.error}`);
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
        searchPlaceholder="Client's or portal user's name"
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
            portalUsers={portalUsers}
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
  portalUsers,
  pending,
  onCancel,
  onSubmit,
}: {
  editing: ClientRow | null;
  countries: Option[];
  portalUsers: PortalUserOption[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (values: {
    name: string;
    country_id: string;
    language: EmailLanguage | null;
    user_ids: string[];
  }) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [countryId, setCountryId] = useState(editing?.country_id ?? "");
  const [language, setLanguage] = useState(editing?.language ?? null);
  const [userIds, setUserIds] = useState<string[]>(() =>
    editing ? portalUsers.filter((u) => u.client_id === editing.id).map((u) => u.id) : []
  );

  // Rótulo avisa quando marcar alguém move-o de outro cliente para este — sem
  // isso a troca acontece "escondida" ao salvar (ver feedback sobre WYSIWYG).
  const userOptions = useMemo(
    () =>
      portalUsers.map((u) => {
        const elsewhere =
          u.client_id && u.client_id !== editing?.id ? (u.client_name ?? undefined) : undefined;
        const tags = [u.blocked ? "blocked" : null, elsewhere ? `currently: ${elsewhere}` : null]
          .filter(Boolean)
          .join(" · ");
        return { id: u.id, name: tags ? `${u.full_name} (${tags})` : u.full_name };
      }),
    [portalUsers, editing]
  );

  const valid = !!name.trim() && !!countryId;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid)
          onSubmit({ name: name.trim(), country_id: countryId, language, user_ids: userIds });
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

      <div className="space-y-1.5">
        <Label>Checklist e-mail language</Label>
        <Select
          value={language ?? USE_COUNTRY_DEFAULT}
          onValueChange={(v) => setLanguage(v === USE_COUNTRY_DEFAULT ? null : (v as EmailLanguage))}
        >
          <SelectTrigger className="!h-10 w-full bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={USE_COUNTRY_DEFAULT}>Use country default</SelectItem>
            <SelectItem value="pt-BR">{LANGUAGE_LABELS["pt-BR"]}</SelectItem>
            <SelectItem value="en">{LANGUAGE_LABELS.en}</SelectItem>
            <SelectItem value="zh">{LANGUAGE_LABELS.zh}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Overrides the country&apos;s default language for this client&apos;s checklist e-mails.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Portal users</Label>
        <MultiSearchSelect
          value={userIds}
          onChange={setUserIds}
          options={userOptions}
          placeholder="Choose some users..."
        />
        <p className="text-xs text-muted-foreground">
          External users (role Client) who sign in to the portal and track this client&apos;s
          orders. Picking a user tied to another client moves them here — same effect as
          changing their Client on the Users screen.
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
