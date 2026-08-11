import "server-only";

import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";

import { getUser } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  FEATURE_KEYS,
  FULL_ACCESS,
  resolvePermissions,
  type FeatureAction,
  type FeatureKey,
  type GrantRow,
  type PermissionMap,
} from "@/domain/access/features";

/**
 * Guarda de autenticação dos Route Handlers da API (app/api/**).
 *
 * Diferente de `verifySession()` (lib/dal.ts), NÃO redireciona: devolve
 * respostas JSON (401/403) próprias para consumo via `fetch`. Aceita duas vias:
 *
 *  1. TOKEN de serviço (máquina-a-máquina): `Authorization: Bearer <API_TOKEN>`.
 *     Habilitado só quando a env `API_TOKEN` está setada. `userId` fica null
 *     (as inserções gravam `created_by = null`). É como o middleware/GSS entra.
 *  2. SESSÃO por cookie (browser logado): mesmo login do app.
 *
 * Em ambos os casos o acesso a dados continua via `service_role` no servidor
 * (RLS deny-all). O token é comparado em tempo constante.
 */

export type ApiSession = {
  /** id do profile logado, ou `null` quando autenticado por token de serviço. */
  userId: string | null;
  email: string | null;
  isAdmin: boolean;
  /** true quando entrou pelo `Authorization: Bearer` (não por cookie). */
  viaToken: boolean;
  /**
   * Permissões por feature. Quem entra por TOKEN recebe acesso total: é a
   * integração máquina-a-máquina (GSS), que não tem papel no RBAC e quebraria
   * se dependesse de linha em `role_features`. Quem entra por COOKIE carrega as
   * mesmas permissões que teria na UI.
   */
  permissions: PermissionMap;
};

const TOKEN_PERMISSIONS: PermissionMap = Object.fromEntries(
  FEATURE_KEYS.map((key) => [key, { ...FULL_ACCESS }])
) as PermissionMap;

export type ApiAuthResult =
  | { ok: true; session: ApiSession }
  | { ok: false; response: Response };

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

/** Comparação em tempo constante (evita timing attack no token). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function requireApiSession(): Promise<ApiAuthResult> {
  // --- Via 1: token de serviço (só se API_TOKEN estiver configurado) ---------
  const expected = process.env.API_TOKEN;
  if (expected) {
    const authz = (await headers()).get("authorization");
    const token = authz?.startsWith("Bearer ") ? authz.slice(7).trim() : null;
    if (token) {
      if (safeEqual(token, expected)) {
        return {
          ok: true,
          session: {
            userId: null,
            email: null,
            isAdmin: true,
            viaToken: true,
            permissions: TOKEN_PERMISSIONS,
          },
        };
      }
      return { ok: false, response: json({ error: "Invalid token" }, 401) };
    }
    // Sem header Bearer → cai para a autenticação por sessão abaixo.
  }

  // --- Via 2: sessão por cookie ----------------------------------------------
  const user = await getUser();
  if (!user) {
    return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  }

  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  }
  if (profile.status === "blocked") {
    return { ok: false, response: json({ error: "Account blocked" }, 403) };
  }

  const { data: role } = await admin
    .from("roles")
    .select("name")
    .eq("id", profile.role_id)
    .single();

  const roleName = role?.name ?? "user";
  const isOwner = roleName === "owner";

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
    ok: true,
    session: {
      userId: user.id,
      email: user.email ?? null,
      isAdmin: roleName === "admin",
      viaToken: false,
      permissions: resolvePermissions({ isOwner, roleGrants, userGrants }),
    },
  };
}

/**
 * Checagem de feature para Route Handler — devolve 403 JSON em vez de
 * redirecionar (o equivalente de `requireFeature` para a API).
 */
export function requireApiFeature(
  session: ApiSession,
  feature: FeatureKey,
  action: FeatureAction
): Response | null {
  if (session.permissions[feature][action]) return null;
  return json({ error: "Forbidden" }, 403);
}
