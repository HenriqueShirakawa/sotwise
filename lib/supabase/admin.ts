import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { serverEnv } from "@/lib/env";
import type { Database } from "@/types/database";

type AdminClient = ReturnType<typeof createSupabaseClient<Database>>;

let cached: AdminClient | null = null;

/**
 * Client `service_role` (bypassa RLS + acesso a auth.admin.*). SÓ no servidor.
 * É por onde passa TODO o acesso a dados do app — sempre atrás de autorização
 * na camada de aplicação (ver lib/dal.ts). Nunca importar em código de client.
 */
export function createAdminClient(): AdminClient {
  if (!cached) {
    cached = createSupabaseClient<Database>(
      serverEnv.supabaseUrl,
      serverEnv.supabaseServiceRoleKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
  }
  return cached;
}
