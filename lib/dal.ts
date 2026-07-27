import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Tables } from "@/types/database";

/**
 * Data Access Layer — a fronteira de segurança do app (padrão recomendado no
 * guia de auth do Next 16). `verifySession()` é chamado em CADA page protegida
 * e dentro de CADA Server Action / Route Handler. Não confiar em layout para
 * guarda de rota (Partial Rendering não re-executa layout por navegação).
 */

export type SessionProfile = {
  userId: string;
  email: string | null;
  profile: Tables<"profiles">;
  role: string;
  isAdmin: boolean;
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
 * sessão é encerrada de fato — §3.1). Deduplicado por request via React cache.
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

  return {
    userId: user.id,
    email: user.email ?? null,
    profile,
    role: roleName,
    isAdmin: roleName === "admin",
  };
});

/** Igual a verifySession, mas exige papel admin. Não-admin → volta para /orders. */
export async function requireAdmin(): Promise<SessionProfile> {
  const session = await verifySession();
  if (!session.isAdmin) redirect("/orders");
  return session;
}
