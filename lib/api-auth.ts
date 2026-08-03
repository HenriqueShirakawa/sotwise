import "server-only";

import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";

import { getUser } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";

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
};

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
          session: { userId: null, email: null, isAdmin: true, viaToken: true },
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

  return {
    ok: true,
    session: {
      userId: user.id,
      email: user.email ?? null,
      isAdmin: (role?.name ?? "user") === "admin",
      viaToken: false,
    },
  };
}
