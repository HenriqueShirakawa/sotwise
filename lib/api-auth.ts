import "server-only";

import { getUser } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Tables } from "@/types/database";

/**
 * Guarda de autenticação dos Route Handlers da API (app/api/**).
 *
 * Diferente de `verifySession()` (lib/dal.ts), NÃO redireciona: devolve
 * respostas JSON (401/403) próprias para consumo via `fetch`. Mantém o mesmo
 * modelo do resto do app — sessão por cookie + `service_role` no servidor
 * (RLS deny-all). Para consumo EXTERNO por token, cheque um
 * `Authorization: Bearer <token>` aqui (antes do `getUser()`) e devolva a
 * sessão de serviço correspondente.
 */

export type ApiSession = {
  userId: string;
  email: string | null;
  profile: Tables<"profiles">;
  isAdmin: boolean;
};

export type ApiAuthResult =
  | { ok: true; session: ApiSession }
  | { ok: false; response: Response };

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

export async function requireApiSession(): Promise<ApiAuthResult> {
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

  return {
    ok: true,
    session: {
      userId: user.id,
      email: user.email ?? null,
      profile,
      isAdmin: (role?.name ?? "user") === "admin",
    },
  };
}
