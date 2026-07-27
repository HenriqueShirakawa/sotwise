/**
 * Clients usados pelos scripts de migração (server-side apenas).
 * Carrega variáveis de .env.local. NUNCA importar isto em código de client/browser
 * — usa a service_role key, que ignora RLS e tem acesso total.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente ausente: ${name} (ver .env.local)`);
  return v;
}

export const SUPABASE_URL = required("SUPABASE_URL");
const SERVICE_ROLE_KEY = required("SUPABASE_SERVICE_ROLE_KEY");

/** Client admin: bypassa RLS, permite auth.admin.*. Só para scripts. */
export const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Base + token dos endpoints do Bubble (preenchidos quando liberados). */
export const BUBBLE_API_BASE = process.env.BUBBLE_API_BASE ?? "";
export const BUBBLE_API_TOKEN = process.env.BUBBLE_API_TOKEN ?? "";
