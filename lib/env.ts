import "server-only";

/**
 * Env do servidor (nunca vai para o browser). Validado no primeiro import.
 * As variáveis NEXT_PUBLIC_* são lidas diretamente nos clients (o Next as
 * inlina no bundle do browser apenas quando referenciadas literalmente).
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name} (see .env.example)`);
  }
  return value;
}

export const serverEnv = {
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
} as const;
