/**
 * Leitura rápida de factory_products (via service_role) — quantos existem com
 * gss_id e alguns exemplos, pra montar os items[] do POST /api/gss/orders.
 *
 *   npx tsx scripts/sync-gss/peek-factory-products.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { count, error: cErr } = await sb
    .from("factory_products")
    .select("*", { count: "exact", head: true })
    .not("gss_id", "is", null)
    .is("deleted_at", null);
  if (cErr) {
    console.log("ERRO:", cErr.message);
    return;
  }
  console.log(`factory_products com gss_id (ativos): ${count ?? 0}`);

  const { data, error } = await sb
    .from("factory_products")
    .select("gss_id, code, factory_id, category_id, city_id")
    .not("gss_id", "is", null)
    .is("deleted_at", null)
    .limit(8);
  if (error) {
    console.log("ERRO amostra:", error.message);
    return;
  }
  console.log("\nExemplos (use o gss_id como supplier_category_gss_id):");
  console.table(data);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
