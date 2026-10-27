/**
 * Cria no DESTINO os usuários do Auth que existem na origem e faltam lá — com o
 * MESMO id (o `profiles.id` copiado aponta pra ele) e o mesmo e-mail. Sem PAT
 * não dá pra ler o hash da senha da origem, então eles entram SEM senha e
 * precisam usar "Forgot password" uma vez (27/10/2026).
 *
 *   npx tsx scripts/migrate-project/criar-usuarios-faltantes.ts            # cria
 *   npx tsx scripts/migrate-project/criar-usuarios-faltantes.ts --dry-run  # só lista
 *
 * Lê SRC_/DST_SUPABASE_URL e SRC_/DST_SERVICE_ROLE_KEY de `.env.migracao`.
 */
import { config } from "dotenv";
config({ path: ".env.migracao" });

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente ausente: ${name} (ver .env.migracao)`);
  return v;
}

const dryRun = process.argv.includes("--dry-run");
const opts = { auth: { autoRefreshToken: false, persistSession: false } };
const src = createClient(required("SRC_SUPABASE_URL"), required("SRC_SERVICE_ROLE_KEY"), opts);
const dst = createClient(required("DST_SUPABASE_URL"), required("DST_SERVICE_ROLE_KEY"), opts);

async function allUsers(c: SupabaseClient): Promise<User[]> {
  const out: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await c.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    out.push(...data.users);
    if (data.users.length < 200) return out;
  }
}

async function main() {
  const [origem, destino] = await Promise.all([allUsers(src), allUsers(dst)]);
  const noDestino = new Set(destino.map((u) => u.id));
  const faltam = origem.filter((u) => !noDestino.has(u.id));
  console.log(`origem ${origem.length} · destino ${destino.length} · faltam ${faltam.length}`);

  for (const u of faltam) {
    if (dryRun) {
      console.log(`  [dry-run] ${u.email} (${u.id})`);
      continue;
    }
    const { error } = await dst.auth.admin.createUser({
      id: u.id,
      email: u.email,
      email_confirm: true,
      user_metadata: u.user_metadata,
      app_metadata: u.app_metadata,
    });
    console.log(`  ${error ? "ERRO" : "criado"} ${u.email}${error ? `: ${error.message}` : ""}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
