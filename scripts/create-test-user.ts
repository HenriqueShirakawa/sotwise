/**
 * Cria (ou atualiza) um usuário de teste com SENHA, pra logar direto no app sem
 * depender do e-mail de convite (Site URL ainda aponta p/ localhost). Útil pra
 * testar de dois lados (ex.: mensagens Received/Sent) com um segundo login.
 *
 * Roda via service_role (lê .env.local), o único acesso que funciona no AGK prod.
 * Tudo configurável por env — nada versionado. Só a senha é obrigatória:
 *   TEST_USER_PASSWORD='...' npx tsx scripts/create-test-user.ts
 * Opcional: TEST_USER_EMAIL='...', TEST_USER_NAME='...', TEST_USER_ROLE='...',
 * TEST_USER_CLIENT='<nome do cliente>'.
 *
 * Para o papel `client` o vínculo é obrigatório (§3.2.1) — `TEST_USER_CLIENT`
 * recebe o NOME do cliente e o script resolve o id. É o caminho para testar o
 * portal sem passar pelo convite: enquanto o remetente for `onboarding@resend.dev`,
 * o Resend só entrega ao dono da conta e recusa até alias com "+".
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env.local");
}

// ---- Config do usuário de teste (tudo por env) -----------------------------
const EMAIL = process.env.TEST_USER_EMAIL ?? "teste@sotwise.dev";
const PASSWORD = process.env.TEST_USER_PASSWORD;
if (!PASSWORD) {
  throw new Error("Defina TEST_USER_PASSWORD (env ou .env.local) antes de rodar");
}
const FULL_NAME = process.env.TEST_USER_NAME ?? "Usuário Teste";
const ROLE_NAME = process.env.TEST_USER_ROLE ?? "admin";
const CLIENT_NAME = process.env.TEST_USER_CLIENT ?? null;
const COMPANY: "BR" | "China" = "BR";

if (ROLE_NAME === "client" && !CLIENT_NAME) {
  throw new Error("Papel 'client' exige TEST_USER_CLIENT='<nome do cliente>'");
}
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

  // Vínculo do usuário externo. Busca por nome exato (ilike), ignorando os
  // soft-deleted — apontar para cliente apagado deixaria a conta sem escopo.
  let clientId: string | null = null;
  if (CLIENT_NAME) {
    const { data: clients, error: clientErr } = await admin
      .from("clients")
      .select("id, name")
      .is("deleted_at", null)
      .ilike("name", CLIENT_NAME)
      .limit(2);
    if (clientErr) throw clientErr;
    if (!clients?.length) throw new Error(`cliente '${CLIENT_NAME}' não encontrado`);
    if (clients.length > 1) throw new Error(`'${CLIENT_NAME}' casa com mais de um cliente`);
    clientId = clients[0].id;
  }

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
      // null nos papéis internos, no mesmo critério da action de Users: trocar
      // de papel não pode deixar resíduo apontando para um cliente.
      client_id: clientId,
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
  if (clientId) console.log("client:  ", CLIENT_NAME, `(${clientId})`);
  console.log("user id: ", userId);
  console.log("=====================");
}

main().catch((e) => {
  console.error("FALHOU:", e?.message ?? e);
  process.exit(1);
});
