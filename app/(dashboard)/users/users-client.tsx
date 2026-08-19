"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban, CircleCheck, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";

import { statusChipStyle } from "@/lib/status-colors";
// date_of_birth é date puro: formatDateNumeric evita o shift de fuso do new Date().
import { formatDateNumeric } from "@/lib/format";
import { COMPANY_VALUES, type UserCreateInput, type UserUpdateInput } from "@/domain/users/schema";
import type { CompanyType, UserStatus } from "@/types/database";
import {
  RegistrationTable,
  sortableHeader,
} from "@/components/registration/registration-table";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/date-picker";
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

import { createUserRecord, updateUserRecord, setUserStatus } from "./actions";

type Role = { id: string; name: string };
type Client = { id: string; name: string };

export type UserRow = {
  id: string;
  full_name: string;
  email: string | null;
  date_of_birth: string | null;
  role_id: string;
  role_name: string;
  company: CompanyType;
  /** Só no papel `client`: a empresa cujos pedidos este usuário acompanha. */
  client_id: string | null;
  client_name: string | null;
  status: UserStatus;
  /** Ativo mas nunca entrou — o convite por e-mail ainda não foi ligado. */
  pending_access: boolean;
  hidden: boolean;
};

const STATUS_HEX: Record<UserStatus, string> = {
  active: "#085D4A",
  blocked: "#B91C1C",
};

/** Âmbar: nem verde de "tudo certo", nem vermelho de bloqueio. */
const PENDING_HEX = "#B45309";

/**
 * "Pending" não é um valor de `user_status` no banco — é o cruzamento de ativo +
 * nunca logado: o convite foi enviado, mas a senha ainda não foi definida.
 * Mostrá-lo como "Active" daria a entender que a conta já está em uso.
 */
const statusLabel = (row: UserRow) => {
  if (row.status === "blocked") return "Blocked";
  return row.pending_access ? "Pending" : "Active";
};

const statusHex = (row: UserRow) =>
  row.status === "active" && row.pending_access ? PENDING_HEX : STATUS_HEX[row.status];
/** Papéis vêm da tabela `roles` em minúsculo (admin/user) — exibidos capitalizados. */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function UsersClient({
  data,
  roles,
  clients,
  currentUserId,
}: {
  data: UserRow[];
  roles: Role[];
  clients: Client[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  // "pending" não é status do banco (ver statusLabel) — entra aqui como filtro
  // derivado para o admin conseguir isolar quem ainda não tem acesso de fato.
  const [status, setStatus] = useState<"all" | UserStatus | "pending">("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [statusTarget, setStatusTarget] = useState<UserRow | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.filter((r) => {
      if (status === "pending" && !r.pending_access) return false;
      if (status === "active" && (r.status !== "active" || r.pending_access)) return false;
      if (status === "blocked" && r.status !== "blocked") return false;
      if (!q) return true;
      return [r.full_name, r.email ?? "", r.role_name, r.company, r.client_name ?? ""].some(
        (v) => v.toLowerCase().includes(q)
      );
    });
  }, [data, search, status]);

  const columns = useMemo<ColumnDef<UserRow>[]>(
    () => [
      {
        accessorKey: "full_name",
        header: sortableHeader<UserRow>("User"),
        cell: ({ row }) => (
          <span className="flex items-center gap-2 text-slate-800">
            {row.original.full_name}
            {row.original.hidden ? (
              <span className="rounded-[4px] border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-500">
                Hidden
              </span>
            ) : null}
          </span>
        ),
      },
      {
        accessorKey: "email",
        header: sortableHeader<UserRow>("E-mail"),
        cell: ({ row }) =>
          row.original.email ?? <span className="text-muted-foreground">—</span>,
      },
      {
        accessorKey: "role_name",
        header: "Profile",
        enableSorting: false,
        // O papel do externo sozinho não diz nada ("Client" — de quem?), então
        // o vínculo anda junto. Coluna própria seria vazia em ~todas as linhas.
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {cap(row.original.role_name)}
            {row.original.client_name ? (
              <span className="text-muted-foreground"> · {row.original.client_name}</span>
            ) : null}
          </span>
        ),
      },
      { accessorKey: "company", header: "Company", enableSorting: false },
      {
        accessorKey: "date_of_birth",
        header: "Date of birth",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.date_of_birth ? (
            formatDateNumeric(row.original.date_of_birth)
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "status",
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => (
          <span
            style={statusChipStyle(statusHex(row.original))}
            className="inline-flex items-center rounded-[4px] border px-2 py-0.5 text-xs font-medium whitespace-nowrap"
            title={
              row.original.pending_access
                ? "Access pending — the invite e-mail is not enabled yet, so this user cannot sign in."
                : undefined
            }
          >
            {statusLabel(row.original)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => {
          const blocked = row.original.status === "blocked";
          /** Ninguém se bloqueia — o botão some na própria linha (o servidor também recusa). */
          const isSelf = row.original.id === currentUserId;
          return (
            <div className="flex justify-end gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-slate-500 hover:text-primary"
                aria-label="Edit"
                onClick={() => {
                  setEditing(row.original);
                  setFormOpen(true);
                }}
              >
                <Pencil className="size-4" />
              </Button>
              {isSelf ? null : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={
                    blocked
                      ? "text-slate-500 hover:text-emerald-700"
                      : "text-slate-500 hover:text-destructive"
                  }
                  aria-label={blocked ? "Unblock" : "Block"}
                  onClick={() => setStatusTarget(row.original)}
                >
                  {blocked ? <CircleCheck className="size-4" /> : <Ban className="size-4" />}
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [currentUserId]
  );

  function handleSubmit(values: UserCreateInput | UserUpdateInput) {
    startTransition(async () => {
      const res = editing
        ? await updateUserRecord(editing.id, values as UserUpdateInput)
        : await createUserRecord(values as UserCreateInput);
      if (res.ok) {
        toast.success(
          editing
            ? "User updated."
            : "User created. An invite e-mail was sent so they can set a password."
        );
        setFormOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function handleStatusChange() {
    if (!statusTarget) return;
    const next = statusTarget.status === "blocked" ? "active" : "blocked";
    startTransition(async () => {
      const res = await setUserStatus(statusTarget.id, next);
      if (res.ok) {
        toast.success(next === "blocked" ? "User blocked." : "User unblocked.");
        setStatusTarget(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  const blocking = statusTarget?.status === "active";

  return (
    <>
      <RegistrationTable
        title="Users"
        subtitle="View, manage, and create new users"
        createLabel="Create new user"
        onCreate={() => {
          setEditing(null);
          setFormOpen(true);
        }}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="User name, e-mail or profile"
        columns={columns}
        data={filtered}
        defaultSorting={[{ id: "full_name", desc: false }]}
        cardHeaderColumnIds={["status", "actions"]}
        cardBreakpoint="720"
        emptyMessage="No users found."
        filters={
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as "all" | UserStatus | "pending")}
          >
            <SelectTrigger className="!h-11 w-44 rounded-xl bg-white">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="blocked">Blocked</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-primary">
              {editing ? "Edit user" : "Create user"}
            </DialogTitle>
          </DialogHeader>
          <UserForm
            key={editing?.id ?? "new"}
            editing={editing}
            roles={roles}
            clients={clients}
            pending={pending}
            onCancel={() => setFormOpen(false)}
            onSubmit={handleSubmit}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!statusTarget}
        onOpenChange={(o) => !o && setStatusTarget(null)}
        title={blocking ? "Block user?" : "Unblock user?"}
        description={
          statusTarget
            ? blocking
              ? `"${statusTarget.full_name}" loses access immediately — any active session ends on the next request.`
              : `"${statusTarget.full_name}" gets access back.`
            : undefined
        }
        confirmLabel={blocking ? "Block" : "Unblock"}
        destructive={blocking}
        loading={pending}
        onConfirm={handleStatusChange}
      />
    </>
  );
}

function UserForm({
  editing,
  roles,
  clients,
  pending,
  onCancel,
  onSubmit,
}: {
  editing: UserRow | null;
  roles: Role[];
  clients: Client[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (values: UserCreateInput | UserUpdateInput) => void;
}) {
  const [fullName, setFullName] = useState(editing?.full_name ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [dateOfBirth, setDateOfBirth] = useState(editing?.date_of_birth ?? "");
  const [roleId, setRoleId] = useState(editing?.role_id ?? "");
  const [company, setCompany] = useState<CompanyType | "">(editing?.company ?? "");
  const [clientId, setClientId] = useState(editing?.client_id ?? "");
  const [hidden, setHidden] = useState(editing?.hidden ?? false);

  // O campo Client só existe para o papel externo. A checagem é pelo NOME do
  // papel (o id é uuid gerado), e o servidor repete a validação — aqui é só UI.
  const isClientRole = roles.find((r) => r.id === roleId)?.name === "client";

  const valid =
    !!fullName.trim() &&
    !!roleId &&
    !!company &&
    (!!editing || !!email.trim()) &&
    (!isClientRole || !!clientId);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || !company) return;
        const base = {
          full_name: fullName.trim(),
          date_of_birth: dateOfBirth.trim() || null,
          role_id: roleId,
          company,
          // Papel interno nunca manda vínculo — e o servidor força null de
          // qualquer forma, então trocar de papel não deixa resíduo.
          client_id: isClientRole ? clientId : null,
        };
        onSubmit(editing ? { ...base, hidden } : { ...base, email: email.trim() });
      }}
    >
      <p className="border-b pb-2 text-sm text-muted-foreground">Main information</p>

      <div className="space-y-1.5">
        <Label htmlFor="full_name">Full name</Label>
        <Input
          id="full_name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Insert full name"
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Insert e-mail"
          disabled={!!editing}
        />
        {editing ? (
          <p className="text-xs text-muted-foreground">
            E-mail is managed by the authentication provider and cannot be edited.
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="dob">Date of birth</Label>
          <DatePicker
            id="dob"
            value={dateOfBirth}
            onChange={(v) => setDateOfBirth(v ?? "")}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Company</Label>
          <Select value={company} onValueChange={(v) => setCompany(v as CompanyType)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a company" />
            </SelectTrigger>
            <SelectContent>
              {COMPANY_VALUES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Profile</Label>
        <Select value={roleId} onValueChange={setRoleId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a profile" />
          </SelectTrigger>
          <SelectContent>
            {roles.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {cap(r.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isClientRole ? (
        <div className="space-y-1.5">
          <Label>Client</Label>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a client" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            External user — signs in to the client portal and sees this client&apos;s orders
            only, never the internal screens.
          </p>
        </div>
      ) : null}

      {editing ? (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <Checkbox checked={hidden} onCheckedChange={(c) => setHidden(c === true)} />
          Hidden — keeps the account working, but hides it from listings
        </label>
      ) : (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted-foreground">
          The user is created without a password. Sign-in only works once the invite e-mail
          flow is enabled in Supabase Auth.
        </p>
      )}

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
