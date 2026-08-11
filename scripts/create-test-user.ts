/**
 * Cria (ou atualiza) um usuário de teste com SENHA para entregar a revisores
 * externos (ex.: App Review da Shopee no dev center). Diferente do fluxo do app
 * (users/actions.ts), aqui setamos senha + email_confirm para o revisor logar
 * direto, sem depender de e-mail de convite (Site URL ainda aponta p/ localhost).
 *
 * Roda via service_role (lê .env.local), o único acesso que funciona no AGK prod.
 * A senha vem de TEST_USER_PASSWORD (env ou .env.local) — nunca versionada.
 *   TEST_USER_PASSWORD='...' npx tsx scripts/create-test-user.ts
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env.local");
}

// ---- Config do usuário de teste --------------------------------------------
const EMAIL = "shopee-review@sotwise.dev";
const PASSWORD = process.env.TEST_USER_PASSWORD!;
if (!PASSWORD) {
  throw new Error("Defina TEST_USER_PASSWORD (env ou .env.local) antes de rodar");
}
const FULL_NAME = "Shopee Review (test)";
const ROLE_NAME: "admin" | "user" = "admin";
const COMPANY: "BR" | "China" = "BR";
// ----------------------------------------------------------------------------

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findAuthUserByEmail(email: string): Promise<string | null> {
  // Sem getUserByEmail no SDK; varre a 1a página (cobre a base atual).
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  return found?.id ?? null;
}

async function main() {
  const { data: roles, error: rolesErr } = await admin.from("roles").select("id, name");
  if (rolesErr) throw rolesErr;
  const roleId = (roles ?? []).find((r) => r.name === ROLE_NAME)?.id as string | undefined;
  if (!roleId) throw new Error(`role '${ROLE_NAME}' não encontrado na tabela roles`);

  // 1) Auth user (cria; se já existe, atualiza a senha para um valor conhecido)
  let userId: string;
  const created = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: FULL_NAME },
  });

  if (created.error) {
    const already = /registered|already/i.test(created.error.message);
    if (!already) throw created.error;
    const existingId = await findAuthUserByEmail(EMAIL);
    if (!existingId) throw created.error;
    userId = existingId;
    const upd = await admin.auth.admin.updateUserById(userId, {
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: FULL_NAME },
    });
    if (upd.error) throw upd.error;
    console.log("• Auth user já existia — senha redefinida.");
  } else {
    userId = created.data.user.id;
    console.log("• Auth user criado.");
  }

  // 2) Profile 1:1 (upsert idempotente)
  const { error: profErr } = await admin.from("profiles").upsert(
    {
      id: userId,
      full_name: FULL_NAME,
      date_of_birth: null,
      role_id: roleId,
      company: COMPANY,
      status: "active",
    },
    { onConflict: "id" }
  );
  if (profErr) throw profErr;
  console.log("• Profile pronto (role/company/status aplicados).");

  console.log("\n===== TEST USER =====");
  console.log("email:   ", EMAIL);
  console.log("senha:   ", PASSWORD);
  console.log("role:    ", ROLE_NAME);
  console.log("company: ", COMPANY);
  console.log("user id: ", userId);
  console.log("=====================");
}

main().catch((e) => {
  console.error("FALHOU:", e?.message ?? e);
  process.exit(1);
});
