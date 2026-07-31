import { requireAdmin } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";

import { UsersClient, type UserRow } from "./users-client";

/**
 * O e-mail vive em `auth.users` (§3.1) e não é replicado no profile, então a
 * lista precisa cruzar as duas fontes. `listUsers` pagina — 53 usuários hoje,
 * mas o loop evita a surpresa quando passar de uma página.
 */
async function loadEmails(
  admin: ReturnType<typeof createAdminClient>
): Promise<Map<string, string>> {
  const emails = new Map<string, string>();
  const perPage = 200;

  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error || !data.users.length) break;
    for (const user of data.users) {
      if (user.email) emails.set(user.id, user.email);
    }
    if (data.users.length < perPage) break;
  }

  return emails;
}

export default async function UsersPage() {
  const session = await requireAdmin(); // não-admin → volta para /orders

  const admin = createAdminClient();
  const [profilesRes, rolesRes, emails] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, date_of_birth, role_id, company, status, hidden")
      .order("full_name"),
    admin.from("roles").select("id, name").order("name"),
    loadEmails(admin),
  ]);

  const roles = rolesRes.data ?? [];
  const roleName = new Map(roles.map((r) => [r.id, r.name]));

  const rows: UserRow[] = (profilesRes.data ?? []).map((p) => ({
    id: p.id,
    full_name: p.full_name,
    email: emails.get(p.id) ?? null,
    date_of_birth: p.date_of_birth,
    role_id: p.role_id,
    role_name: roleName.get(p.role_id) ?? "—",
    company: p.company,
    status: p.status,
    hidden: p.hidden,
  }));

  return <UsersClient data={rows} roles={roles} currentUserId={session.userId} />;
}
