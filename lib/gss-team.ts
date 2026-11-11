import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Usuário de sistema "GSS Team" (11/11/2026, pedido do usuário): quando uma
 * etapa do checklist conclui por um dado que veio do GSS — sem usuário do SOT
 * por trás —, o Signed by e o Responsible em branco ficam com ele, em vez de
 * vazios. Profile com `slug = 'gss-team'`, `status = blocked` (ninguém entra
 * com ele) e `hidden = true` (fora de mensagens/destinatários). Precisa existir
 * em cada banco (dev AGK criado em 11/11; produção: criar antes de levar).
 * Sem ele, o comportamento é o de antes (fica em branco).
 */
export const GSS_TEAM_SLUG = "gss-team";

let cachedId: string | null = null;

export async function gssTeamProfileId(admin: Admin): Promise<string | null> {
  if (cachedId) return cachedId;
  const { data } = await admin.from("profiles").select("id").eq("slug", GSS_TEAM_SLUG).maybeSingle();
  // Só guarda quando achou: se o usuário for criado depois, a próxima chamada pega.
  if (data?.id) cachedId = data.id;
  return data?.id ?? null;
}

/** Quem assina a conclusão automática: o usuário do SOT ou, sem ele, o GSS Team. */
export async function actorOrGssTeam(admin: Admin, userId: string | null): Promise<string | null> {
  return userId ?? (await gssTeamProfileId(admin));
}
