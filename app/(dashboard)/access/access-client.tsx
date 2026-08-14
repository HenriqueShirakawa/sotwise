"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Database, FlaskConical } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { SearchSelect } from "@/components/search-select";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ASSIGNABLE_FEATURE_KEYS,
  FEATURES,
  GRANT_COLUMN,
  type FeatureAction,
  type FeatureKey,
  type GrantRow,
} from "@/domain/access/features";

import { setRoleFeature, setUserFeature } from "./actions";

export type RoleRow = { id: string; name: string; grants: GrantRow[] };
export type UserOverrideRow = {
  id: string;
  fullName: string;
  roleName: string;
  grants: GrantRow[];
};

/** Todas as ações, na ordem do catálogo — as colunas da matriz. */
const COLUMNS: FeatureAction[] = ["view", "create", "edit", "delete"];

const COLUMN_LABEL: Record<FeatureAction, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
};

/** Valor gravado para uma feature/ação, ou null quando não há linha. */
function grantValue(
  grants: GrantRow[],
  feature: FeatureKey,
  action: FeatureAction
): boolean | null {
  const row = grants.find((g) => g.feature_key === feature);
  return row ? (row[GRANT_COLUMN[action]] ?? null) : null;
}

function hasAction(feature: FeatureKey, action: FeatureAction): boolean {
  return (FEATURES[feature].actions as readonly string[]).includes(action);
}

export function AccessClient({
  roles,
  users,
  currentUserId,
}: {
  roles: RoleRow[];
  users: UserOverrideRow[];
  currentUserId: string;
}) {
  return (
    <div>
      <PageHeader
        title="Access control"
        description="Define what each role can do, then open exceptions for individual users."
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {/* Protótipo (mock, não-produção) do modelo Role→Company→User. Owner-only,
            como esta tela. Ver app/(dashboard)/access-lab/. */}
        <Link
          href="/access-lab"
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100"
        >
          <FlaskConical className="size-3.5" />
          Preview: novo modelo de acesso (protótipo)
          <span aria-hidden>→</span>
        </Link>

        {/* Diagnóstico da integração com o GSS — o que a origem devolve e o que
            já pareou aqui. Owner-only, ver app/(dashboard)/access/gss/. */}
        <Link
          href="/access/gss"
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
        >
          <Database className="size-3.5" />
          Dados do GSS
          <span aria-hidden>→</span>
        </Link>
      </div>

      <div className="grid gap-8">
        <RoleMatrix roles={roles} />
        <UserOverrides users={users} currentUserId={currentUserId} />
      </div>
    </div>
  );
}

function RoleMatrix({ roles }: { roles: RoleRow[] }) {
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const role = roles.find((r) => r.id === roleId);

  return (
    <section className="rounded-lg border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Roles</h2>
          <p className="text-xs text-muted-foreground">
            The default every user of the role inherits. The owner role is not listed —
            it always has full access.
          </p>
        </div>
        <div className="w-56">
          <SearchSelect
            value={roleId}
            onChange={setRoleId}
            options={roles.map((r) => ({ id: r.id, name: r.name }))}
            placeholder="Select a role"
          />
        </div>
      </div>

      {role ? (
        <FeatureGrid>
          {ASSIGNABLE_FEATURE_KEYS.map((feature) => (
            <FeatureRow key={feature} feature={feature}>
              {COLUMNS.map((action) => (
                <Cell key={action}>
                  {hasAction(feature, action) ? (
                    <RoleToggle
                      roleId={role.id}
                      feature={feature}
                      action={action}
                      initial={grantValue(role.grants, feature, action) ?? false}
                    />
                  ) : (
                    <NotApplicable />
                  )}
                </Cell>
              ))}
            </FeatureRow>
          ))}
        </FeatureGrid>
      ) : (
        <p className="px-4 py-6 text-sm text-muted-foreground">No roles found.</p>
      )}
    </section>
  );
}

function UserOverrides({
  users,
  currentUserId,
}: {
  users: UserOverrideRow[];
  currentUserId: string;
}) {
  const selectable = users.filter((u) => u.id !== currentUserId);
  const [userId, setUserId] = useState("");
  const user = selectable.find((u) => u.id === userId);

  return (
    <section className="rounded-lg border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">User exceptions</h2>
          <p className="text-xs text-muted-foreground">
            Overrides the role in both directions. Leave on <em>Inherit</em> to follow
            the role.
          </p>
        </div>
        <div className="w-56">
          <SearchSelect
            value={userId}
            onChange={setUserId}
            options={selectable.map((u) => ({ id: u.id, name: u.fullName }))}
            placeholder="Select a user"
          />
        </div>
      </div>

      {user ? (
        <>
          <p className="border-b bg-slate-50 px-4 py-2 text-xs text-muted-foreground">
            Role: <span className="font-medium capitalize">{user.roleName}</span>
          </p>
          <FeatureGrid>
            {ASSIGNABLE_FEATURE_KEYS.map((feature) => (
              <FeatureRow key={feature} feature={feature}>
                {COLUMNS.map((action) => (
                  <Cell key={action}>
                    {hasAction(feature, action) ? (
                      <UserOverrideSelect
                        userId={user.id}
                        feature={feature}
                        action={action}
                        initial={grantValue(user.grants, feature, action)}
                      />
                    ) : (
                      <NotApplicable />
                    )}
                  </Cell>
                ))}
              </FeatureRow>
            ))}
          </FeatureGrid>
        </>
      ) : (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          Select a user to review or override their access.
        </p>
      )}
    </section>
  );
}

/* ---------------- Layout compartilhado pelas duas matrizes ---------------- */

function FeatureGrid({ children }: { children: React.ReactNode }) {
  return (
    // A matriz rola sozinha no eixo X — a página nunca rola horizontalmente.
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        <div className="grid grid-cols-[minmax(160px,1fr)_repeat(4,88px)] items-center border-b bg-slate-50 px-4 py-2">
          <span className="text-xs font-medium text-muted-foreground">Feature</span>
          {COLUMNS.map((action) => (
            <span
              key={action}
              className="text-center text-xs font-medium text-muted-foreground"
            >
              {COLUMN_LABEL[action]}
            </span>
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}

function FeatureRow({
  feature,
  children,
}: {
  feature: FeatureKey;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(160px,1fr)_repeat(4,88px)] items-center border-b px-4 py-2.5 last:border-b-0">
      <span className="text-sm">{FEATURES[feature].label}</span>
      {children}
    </div>
  );
}

function Cell({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-center">{children}</div>;
}

function NotApplicable() {
  return (
    <span className="text-xs text-slate-300" title="Not applicable to this feature">
      —
    </span>
  );
}

/* ------------------------------- Controles ------------------------------- */

function RoleToggle({
  roleId,
  feature,
  action,
  initial,
}: {
  roleId: string;
  feature: FeatureKey;
  action: FeatureAction;
  initial: boolean;
}) {
  // Estado otimista: o switch responde na hora e volta se o servidor recusar.
  const [checked, setChecked] = useState(initial);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggle(next: boolean) {
    setChecked(next);
    startTransition(async () => {
      const res = await setRoleFeature(roleId, feature, action, next);
      if (!res.ok) {
        setChecked(!next);
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Switch
      checked={checked}
      onCheckedChange={toggle}
      disabled={pending}
      aria-label={`${COLUMN_LABEL[action]} ${FEATURES[feature].label}`}
    />
  );
}

/** `null` = herda do papel; true/false = sobrepõe. */
const OVERRIDE_OPTIONS = [
  { value: "inherit", label: "Inherit" },
  { value: "allow", label: "Allow" },
  { value: "deny", label: "Deny" },
] as const;

function toOption(value: boolean | null): string {
  if (value === null) return "inherit";
  return value ? "allow" : "deny";
}

function fromOption(option: string): boolean | null {
  if (option === "inherit") return null;
  return option === "allow";
}

function UserOverrideSelect({
  userId,
  feature,
  action,
  initial,
}: {
  userId: string;
  feature: FeatureKey;
  action: FeatureAction;
  initial: boolean | null;
}) {
  const [option, setOption] = useState(toOption(initial));
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function change(next: string) {
    const previous = option;
    setOption(next);
    startTransition(async () => {
      const res = await setUserFeature(userId, feature, action, fromOption(next));
      if (!res.ok) {
        setOption(previous);
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Select value={option} onValueChange={change} disabled={pending}>
      <SelectTrigger
        size="sm"
        className="h-8 w-[84px]"
        aria-label={`${COLUMN_LABEL[action]} ${FEATURES[feature].label}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OVERRIDE_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
