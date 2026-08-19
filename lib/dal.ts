import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  FEATURES,
  FEATURE_KEYS,
  hasFeature,
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
  /**
   * Usuário EXTERNO (do cliente da AGK), não um usuário interno com menos
   * acesso. Vive em `app/(client)/` e nunca recebe feature do catálogo.
   */
  isClient: boolean;
  /** Fronteira de dados do usuário externo. Null em todo papel interno. */
  clientId: string | null;
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
 * Resultado bruto da resolução de sessão. Deduplicado por request via React
 * cache, então as duas queries de permissão custam uma vez por request, não uma
 * por page. Existe porque os Route Handlers não
 * podem redirecionar: um `redirect()` no meio de uma resposta de streaming vira
 * um 307 que o `fetch` do cliente não sabe interpretar — ali a resposta certa é
 * 401. As páginas continuam com `verifySession()`, que traduz isto em redirect.
 */
export type SessionResult =
  | { kind: "ok"; session: SessionProfile }
  | { kind: "anonymous" }
  | { kind: "revoked"; reason: "no_profile" | "blocked" };

export const resolveSession = cache(async (): Promise<SessionResult> => {
  const user = await getUser();
  if (!user) return { kind: "anonymous" };

  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) return { kind: "revoked", reason: "no_profile" };
  if (profile.status === "blocked") return { kind: "revoked", reason: "blocked" };

  const { data: role } = await admin
    .from("roles")
    .select("name")
    .eq("id", profile.role_id)
    .single();

  const roleName = role?.name ?? "user";
  const isOwner = roleName === "owner";
  const isClient = roleName === "client";

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
    kind: "ok",
    session: {
      userId: user.id,
      email: user.email ?? null,
      profile,
      role: roleName,
      isAdmin: roleName === "admin",
      isOwner,
      isClient,
      // Só faz sentido no papel externo: se um profile interno tiver a coluna
      // preenchida (troca de papel malfeita, import), ela é ignorada aqui em
      // vez de virar escopo fantasma.
      clientId: isClient ? profile.client_id : null,
      permissions: resolvePermissions({ isOwner, roleGrants, userGrants }),
    },
  };
});

/**
 * Exige sessão válida + profile ativo, redirecionando quando não há (é o que
 * toda page protegida chama). `blocked` cai em /auth/signout para que a sessão
 * seja encerrada de fato — efeito imediato do bloqueio (§3.1).
 */
export const verifySession = cache(async (): Promise<SessionProfile> => {
  const result = await resolveSession();
  if (result.kind === "anonymous") redirect("/login");
  if (result.kind === "revoked") {
    redirect(result.reason === "blocked" ? "/auth/signout?reason=blocked" : "/auth/signout");
  }
  return result.session;
});

/** Checagem sem redirect — para esconder botão, coluna ou item de menu. */
export function can(
  session: SessionProfile,
  feature: FeatureKey,
  action: FeatureAction = "view"
): boolean {
  return hasFeature(session.permissions, feature, action);
}

/** Raiz do app do cliente externo (route group `app/(client)/`). */
export const CLIENT_HOME = "/portal";

/**
 * Para onde mandar quem não pode ver a rota pedida. Não dá para fixar `/orders`
 * como antes: um usuário sem a feature `orders` cairia num loop de redirect
 * entre a página negada e o destino. Primeira feature visível na ordem do
 * catálogo; sem nenhuma, sobra o profile (que não é feature e todo autenticado
 * acessa).
 */
function landingPath(session: SessionProfile): string {
  // O externo não tem feature nenhuma — sem este atalho ele cairia em /profile,
  // que é tela interna. É por aqui que todo `requireFeature` negado devolve o
  // cliente para o painel dele, em vez de deixá-lo vagando pelo app interno.
  if (session.isClient) return CLIENT_HOME;

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

/**
 * Sessão com escopo de cliente — a guarda de TODA page e action do
 * `app/(client)/`. Devolve o `clientId` já validado para a query poder filtrar
 * por ele; nenhuma leitura do portal deve rodar sem esse valor na mão.
 *
 * Cliente sem `client_id` é conta quebrada (papel trocado na mão, import
 * incompleto). Cai em signout em vez de landingPath por dois motivos: sem
 * escopo não existe página para onde mandá-lo — `landingPath` devolveria o
 * próprio /portal e fecharia um loop de redirect — e a sessão precisa acabar
 * mesmo, para o admin corrigir o vínculo antes de ele entrar de novo.
 */
export async function requireClientScope(): Promise<{
  session: SessionProfile;
  clientId: string;
}> {
  const session = await verifySession();
  if (!session.isClient) redirect(landingPath(session));
  if (!session.clientId) redirect("/auth/signout?reason=no_client");
  return { session, clientId: session.clientId };
}

/**
 * Contraparte: telas internas SEM feature própria (hoje `/profile` e o layout
 * do dashboard) — todo autenticado entra, menos o externo.
 *
 * As telas que TÊM feature já barram o cliente sozinhas, porque o papel
 * `client` não recebe linha em `role_features` e o mapa resolve tudo `false`.
 * Esta função cobre o resto, para o externo não esbarrar no chrome interno
 * (sidebar, caixa de mensagens, copilot) por uma URL digitada.
 */
export async function requireInternal(): Promise<SessionProfile> {
  const session = await verifySession();
  if (session.isClient) redirect(CLIENT_HOME);
  return session;
}
