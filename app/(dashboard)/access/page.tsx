import { requireOwner } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import type { GrantRow } from "@/domain/access/features";

import { AccessClient, type RoleRow, type UserOverrideRow } from "./access-client";

/**
 * Painel de acessos — exclusivo do owner (`requireOwner`, não `requireFeature`:
 * a feature `access` é owner-only e nunca resolve `true` para mais ninguém).
 *
 * Duas seções: a matriz papel × feature (o padrão que todo mundo daquele papel
 * herda) e as exceções por usuário (que sobrepõem o papel nos dois sentidos).
 */
/** Descarta a coluna de dono (role_id / user_id) e deixa só a concessão. */
function toGrantRow(row: GrantRow): GrantRow {
  return {
    feature_key: row.feature_key,
    can_view: row.can_view,
    can_create: row.can_create,
    can_edit: row.can_edit,
    can_delete: row.can_delete,
  };
}

export default async function AccessPage() {
  const session = await requireOwner();
  const admin = createAdminClient();

  const grantColumns = "feature_key, can_view, can_create, can_edit, can_delete";
  const [rolesRes, roleGrantsRes, profilesRes, userGrantsRes] = await Promise.all([
    admin.from("roles").select("id, name").order("name"),
    admin.from("role_features").select(`role_id, ${grantColumns}`),
    admin
      .from("profiles")
      .select("id, full_name, role_id, status")
      .eq("status", "active")
      .order("full_name"),
    admin.from("user_features").select(`user_id, ${grantColumns}`),
  ]);

  const roleGrants = (roleGrantsRes.data ?? []) as (GrantRow & { role_id: string })[];
  const userGrants = (userGrantsRes.data ?? []) as (GrantRow & { user_id: string })[];

  // O owner fica fora da matriz: acesso total por código, sem linha no banco.
  const roles: RoleRow[] = (rolesRes.data ?? [])
    .filter((r) => r.name !== "owner")
    .map((r) => ({
      id: r.id,
      name: r.name,
      grants: roleGrants.filter((g) => g.role_id === r.id).map(toGrantRow),
    }));

  const roleName = new Map((rolesRes.data ?? []).map((r) => [r.id, r.name]));

  const users: UserOverrideRow[] = (profilesRes.data ?? []).map((p) => ({
    id: p.id,
    fullName: p.full_name,
    roleName: roleName.get(p.role_id) ?? "—",
    grants: userGrants.filter((g) => g.user_id === p.id).map(toGrantRow),
  }));

  return <AccessClient roles={roles} users={users} currentUserId={session.userId} />;
}
