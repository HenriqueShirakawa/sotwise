import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  FEATURES,
  FEATURE_KEYS,
  resolvePermissions,
  type FeatureAction,
  type FeatureKey,
  type GrantRow,
  type PermissionMap,
} from "@/domain/access/features";
import type { Tables } from "@/types/database";

/**
 * Data Access Layer — a fronteira de segurança do app (padrão recomendado no
 * guia de auth do Next 16). `verifySession()` é chamado em CADA page protegida
 * e dentro de CADA Server Action / Route Handler. Não confiar em layout para
 * guarda de rota (Partial Rendering não re-executa layout por navegação).
 *
 * A autorização é 100% aqui: as tabelas estão em RLS deny-all e todo acesso sai
 * pelo `createAdminClient()` (service_role, que ignora RLS). Não existe segunda
 * linha de defesa no banco — por isso toda page e toda action precisam passar
 * por `requireFeature`.
 */

export type SessionProfile = {
  userId: string;
  email: string | null;
  profile: Tables<"profiles">;
  role: string;
  isAdmin: boolean;
  isOwner: boolean;
  /** Mapa já resolvido (papel + exceções do usuário). Seguro para o cliente. */
  permissions: PermissionMap;
};

/** Sessão autenticada (ou null). Sem redirect — usado por guardas de rota pública. */
export const getUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * Exige sessão válida + profile ativo. Redireciona para /login quando ausente,
 * e para /auth/signout quando o usuário está `blocked` (efeito imediato: a
 * sessão é encerrada de fato — §3.1). Deduplicado por request via React cache,
 * então as duas queries de permissão custam uma vez por request, não por page.
 */
export const verifySession = cache(async (): Promise<SessionProfile> => {
  const user = await getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/auth/signout");
  if (profile.status === "blocked") redirect("/auth/signout?reason=blocked");

  const { data: role } = await admin
    .from("roles")
    .select("name")
    .eq("id", profile.role_id)
    .single();

  const roleName = role?.name ?? "user";
  const isOwner = roleName === "owner";

  // O owner não depende de linha em role_features (bypass em código — ver o
  // cabeçalho da migration), então nem consultamos nesse caso.
  const grantColumns = "feature_key, can_view, can_create, can_edit, can_delete";
  const [roleGrants, userGrants] = isOwner
    ? [[], []]
    : await Promise.all([
        admin
          .from("role_features")
          .select(grantColumns)
          .eq("role_id", profile.role_id)
          .then((r) => (r.data ?? []) as GrantRow[]),
        admin
          .from("user_features")
          .select(grantColumns)
          .eq("user_id", user.id)
          .then((r) => (r.data ?? []) as GrantRow[]),
      ]);

  return {
    userId: user.id,
    email: user.email ?? null,
    profile,
    role: roleName,
    isAdmin: roleName === "admin",
    isOwner,
    permissions: resolvePermissions({ isOwner, roleGrants, userGrants }),
  };
});

/** Checagem sem redirect — para esconder botão, coluna ou item de menu. */
export function can(
  session: SessionProfile,
  feature: FeatureKey,
  action: FeatureAction = "view"
): boolean {
  return session.permissions[feature][action];
}

/**
 * Para onde mandar quem não pode ver a rota pedida. Não dá para fixar `/orders`
 * como antes: um usuário sem a feature `orders` cairia num loop de redirect
 * entre a página negada e o destino. Primeira feature visível na ordem do
 * catálogo; sem nenhuma, sobra o profile (que não é feature e todo autenticado
 * acessa).
 */
function landingPath(session: SessionProfile): string {
  for (const key of FEATURE_KEYS) {
    if (session.permissions[key].view) return FEATURES[key].routes[0];
  }
  return "/profile";
}

/**
 * Guarda de rota/ação por feature. `action` default `view` porque a maioria das
 * chamadas é de page; actions de escrita passam `create`/`edit`/`delete`.
 */
export async function requireFeature(
  feature: FeatureKey,
  action: FeatureAction = "view"
): Promise<SessionProfile> {
  const session = await verifySession();
  if (!session.permissions[feature][action]) redirect(landingPath(session));
  return session;
}

/**
 * Guarda para action alcançável por mais de uma feature — basta UMA passar.
 *
 * O caso real é a ETD: `EtdStepTable` é renderizada tanto no detalhe da Order
 * quanto no modal de ETD factories, então as actions de ETD são atingidas por
 * dois caminhos. Exigir só `orders` trancaria quem tem apenas `etd_factories`,
 * e vice-versa.
 */
export async function requireAnyFeature(
  specs: readonly (readonly [FeatureKey, FeatureAction])[]
): Promise<SessionProfile> {
  const session = await verifySession();
  const allowed = specs.some(([feature, action]) => session.permissions[feature][action]);
  if (!allowed) redirect(landingPath(session));
  return session;
}

/**
 * Exclusiva do owner (tela de acessos). Separada de `requireFeature("access")`
 * porque `access` é owner-only no catálogo e portanto nunca resolve `true` para
 * mais ninguém — esta função deixa a intenção explícita na chamada.
 */
export async function requireOwner(): Promise<SessionProfile> {
  const session = await verifySession();
  if (!session.isOwner) redirect(landingPath(session));
  return session;
}
