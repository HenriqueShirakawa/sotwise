/** Smoke test de conectividade Supabase (service_role). Roda: npx tsx scripts/migrate/check.ts */
import { supabaseAdmin, SUPABASE_URL, BUBBLE_API_BASE } from "./client";

async function main() {
  console.log("SUPABASE_URL:", SUPABASE_URL);

  const { data: roles, error: rErr } = await supabaseAdmin
    .from("roles")
    .select("name")
    .order("name");
  if (rErr) throw rErr;
  console.log("roles:", roles?.map((r) => r.name).join(", "));

  const { data: userList, error: uErr } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (uErr) throw uErr;
  console.log("auth.admin OK — total de usuários (aprox.):", userList.users.length, "na primeira página");

  console.log("BUBBLE_API_BASE:", BUBBLE_API_BASE || "(vazio — aguardando endpoints)");
  console.log("OK: conexão service_role funcional.");
}

main().catch((e) => {
  console.error("FALHOU:", e.message ?? e);
  process.exit(1);
});
