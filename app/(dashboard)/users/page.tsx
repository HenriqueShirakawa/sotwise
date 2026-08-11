import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";

import { UsersClient, type UserRow } from "./users-client";

type AuthInfo = { email: string | null; signedInOnce: boolean };

/**
 * O e-mail vive em `auth.users` (§3.1) e não é replicado no profile, então a
 * lista precisa cruzar as duas fontes. `listUsers` pagina — 53 usuários hoje,
 * mas o loop evita a surpresa quando passar de uma página.
 *
 * De quebra traz `last_sign_in_at`: enquanto o convite por e-mail não estiver
 * ligado, o usuário criado nasce sem senha e não consegue entrar. O profile já
 * nasce `active`, então sem esse sinal a lista mostrava "Active" para quem nunca
 * teve acesso — exatamente o que o próprio toast de criação avisa que não vale.
 */
async function loadAuthInfo(
  admin: ReturnType<typeof createAdminClient>
): Promise<Map<string, AuthInfo>> {
  const info = new Map<string, AuthInfo>();
  const perPage = 200;

  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error || !data.users.length) break;
    for (const user of data.users) {
      info.set(user.id, {
        email: user.email ?? null,
        signedInOnce: Boolean(user.last_sign_in_at),
      });
    }
    if (data.users.length < perPage) break;
  }

  return info;
}

export default async function UsersPage() {
  const session = await requireFeature("users"); // sem a feature → volta para a primeira tela visível

  const admin = createAdminClient();
  const [profilesRes, rolesRes, authInfo] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, date_of_birth, role_id, company, status, hidden")
      .order("full_name"),
    admin.from("roles").select("id, name").order("name"),
    loadAuthInfo(admin),
  ]);

  const roles = rolesRes.data ?? [];
  const roleName = new Map(roles.map((r) => [r.id, r.name]));

  const rows: UserRow[] = (profilesRes.data ?? []).map((p) => {
    const auth = authInfo.get(p.id);
    return {
      id: p.id,
      full_name: p.full_name,
      email: auth?.email ?? null,
      date_of_birth: p.date_of_birth,
      role_id: p.role_id,
      role_name: roleName.get(p.role_id) ?? "—",
      company: p.company,
      status: p.status,
      // Só pendura "Pending" em quem está ativo: bloqueado que nunca entrou
      // continua sendo "Blocked", que é a informação que importa.
      pending_access: p.status === "active" && !auth?.signedInOnce,
      hidden: p.hidden,
    };
  });

  return <UsersClient data={rows} roles={roles} currentUserId={session.userId} />;
}
