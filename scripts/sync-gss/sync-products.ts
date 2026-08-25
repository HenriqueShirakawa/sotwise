/**
 * Sync dos PRODUTOS da fábrica GSS → SOTWISE.
 *
 * Fonte: `/core/supplier-category/` (a granularidade fina — ver a migration
 * 20260825120000_factory_products.sql). Cada linha do GSS é um produto:
 * (fábrica, categoria, cidade, code), com id próprio. Faz upsert por `gss_id`
 * (o id da supplier-category no GSS), traduzindo supplier→factory_id,
 * category→category_id, city→city_id pelos `gss_id` já pareados das bibliotecas.
 *
 *   npx tsx scripts/sync-gss/sync-products.ts            # DRY-RUN (só o plano)
 *   npx tsx scripts/sync-gss/sync-products.ts --commit   # aplica
 *   npx tsx scripts/sync-gss/sync-products.ts --commit --soft-delete  # + apaga o que sumiu do GSS
 *
 * Requer a migration `factory_products` aplicada no AGK. Rodar de máquina
 * allowlistada (Cloudflare do GSS) — ver [[gss-sync-motor]].
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { gssGet, GSS_ENDPOINTS, type GssSupplierCategory } from "../../lib/gss/client";

const COMMIT = process.argv.includes("--commit");
const SOFT_DELETE = process.argv.includes("--soft-delete");

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
}) as any;

type Existing = { id: string; gss_id: string | null; factory_id: string; category_id: string; city_id: string | null; code: string | null };
type Desired = { gss_id: string; factory_id: string; category_id: string; city_id: string | null; code: string | null };

/** gss_id(string) → uuid local, só linhas vivas. */
async function gssMap(table: string): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select("id, gss_id").is("deleted_at", null).not("gss_id", "is", null).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const r of data ?? []) m.set(String(r.gss_id), r.id);
    if (!data || data.length < PAGE) break;
  }
  return m;
}

async function loadExisting(): Promise<Existing[]> {
  const out: Existing[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("factory_products").select("id, gss_id, factory_id, category_id, city_id, code").range(from, from + PAGE - 1);
    if (error) {
      if (/relation .*factory_products.* does not exist|Could not find the table/i.test(error.message)) {
        throw new Error("Tabela `factory_products` não existe no AGK — aplique a migration 20260825120000_factory_products.sql primeiro.");
      }
      throw new Error(`factory_products: ${error.message}`);
    }
    out.push(...((data ?? []) as Existing[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const eq = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

async function main() {
  console.log(`\n== Sync PRODUTOS (supplier-category) GSS → SOTWISE  [${COMMIT ? "COMMIT" : "DRY-RUN"}${SOFT_DELETE ? ", soft-delete" : ""}] ==\n`);

  const r = await gssGet<GssSupplierCategory[]>(GSS_ENDPOINTS.supplierCategory);
  if (!r.ok) throw new Error(`GSS supplier-category: ${r.error}`);
  const sc = r.data;

  const [facMap, catMap, cityMap] = await Promise.all([gssMap("factories"), gssMap("categories"), gssMap("cities")]);
  const existing = await loadExisting();
  const byGss = new Map<string, Existing>();
  for (const e of existing) if (e.gss_id) byGss.set(e.gss_id, e);

  const inserts: Desired[] = [];
  const updates: { id: string; changes: Partial<Desired>; gss_id: string }[] = [];
  let unresolved = 0;
  const desiredIds = new Set<string>();

  for (const row of sc) {
    const factory_id = facMap.get(String(row.supplier));
    const category_id = catMap.get(String(row.category));
    if (!factory_id || !category_id) { unresolved++; continue; } // fábrica/categoria ainda sem gss_id
    const gss_id = String(row.id);
    desiredIds.add(gss_id);
    const city_id = row.city != null ? cityMap.get(String(row.city)) ?? null : null;
    const code = row.code ?? null;
    const cur = byGss.get(gss_id);
    if (!cur) { inserts.push({ gss_id, factory_id, category_id, city_id, code }); continue; }
    const changes: Partial<Desired> = {};
    if (!eq(cur.factory_id, factory_id)) changes.factory_id = factory_id;
    if (!eq(cur.category_id, category_id)) changes.category_id = category_id;
    if (!eq(cur.city_id, city_id)) changes.city_id = city_id;
    if (!eq(cur.code, code)) changes.code = code;
    if (Object.keys(changes).length) updates.push({ id: cur.id, changes, gss_id });
  }

  // sumiu do GSS: nossa linha com gss_id que o GSS não lista mais
  const missing = existing.filter((e) => e.gss_id && !desiredIds.has(e.gss_id));

  console.log(`GSS supplier-category: ${sc.length} linhas`);
  console.log(`  resolvíveis (fábrica+categoria pareadas): ${sc.length - unresolved}`);
  console.log(`  unresolved (lado sem gss_id): ${unresolved}`);
  console.log(`Plano: insert ${inserts.length}, update ${updates.length}, sumiu ${missing.length}${SOFT_DELETE ? " (soft-delete)" : " (só relato)"}`);
  if (missing.length) console.log(`  sumiu: ${missing.slice(0, 8).map((m) => m.gss_id).join(", ")}${missing.length > 8 ? " …" : ""}`);

  if (!COMMIT) {
    console.log("\nDry-run: nada gravado. Rode com --commit.");
    return;
  }

  const B = 500;
  for (let i = 0; i < inserts.length; i += B) {
    const { error } = await db.from("factory_products").insert(inserts.slice(i, i + B));
    if (error) throw new Error(`insert [${i}..]: ${error.message}`);
  }
  const CH = 25;
  for (let i = 0; i < updates.length; i += CH) {
    await Promise.all(updates.slice(i, i + CH).map(async (u) => {
      const { error } = await db.from("factory_products").update(u.changes).eq("id", u.id);
      if (error) throw new Error(`update ${u.gss_id}: ${error.message}`);
    }));
  }
  if (SOFT_DELETE && missing.length) {
    const now = new Date().toISOString();
    for (let i = 0; i < missing.length; i += CH) {
      await Promise.all(missing.slice(i, i + CH).map(async (m) => {
        const { error } = await db.from("factory_products").update({ deleted_at: now }).eq("id", m.id);
        if (error) throw new Error(`soft-delete ${m.gss_id}: ${error.message}`);
      }));
    }
  }

  console.log(`\n✔ GRAVADO: insert ${inserts.length}, update ${updates.length}${SOFT_DELETE ? `, soft-delete ${missing.length}` : ""}`);
}

main().catch((e) => { console.error("FALHOU:", e); process.exit(1); });
