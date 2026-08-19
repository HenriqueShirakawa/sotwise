/**
 * Fila de revisão dos nomes PARECIDOS que não casaram exato (INTEGRACAO_GSS §9.9).
 *
 *   npx tsx scripts/sync-gss/review-similares.ts
 *
 * Só leitura. Reusa o plano do motor (`quaseCasam`) e enriquece cada candidato
 * com o que decide a dúvida:
 *  - quanto a linha LOCAL é usada no transacional (fundir/vincular a linha errada
 *    é caro na proporção do uso);
 *  - nas fábricas, as CATEGORIAS e a CIDADE dos dois lados — se batem, é a mesma
 *    empresa escrita de dois jeitos; se divergem, provavelmente não é.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";
import { runSync } from "../../lib/gss/sync";
import { gssGet, GSS_ENDPOINTS, type GssSupplier, type GssSupplierCategory } from "../../lib/gss/client";

const sb = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function contarUso(): Promise<{
  factories: Map<string, number>;
  clients: Map<string, number>;
  carriers: Map<string, number>;
  orderTypes: Map<string, number>;
}> {
  const tally = (rows: { k: string | null }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.k) m.set(r.k, (m.get(r.k) ?? 0) + 1);
    return m;
  };
  const [ofc, ord, shp] = await Promise.all([
    sb.from("order_factory_category").select("factory_id"),
    sb.from("orders").select("client_id, order_type_id").is("deleted_at", null),
    sb.from("shipments").select("carrier_id").is("deleted_at", null),
  ]);
  return {
    factories: tally((ofc.data ?? []).map((r) => ({ k: r.factory_id }))),
    clients: tally((ord.data ?? []).map((r) => ({ k: r.client_id }))),
    orderTypes: tally((ord.data ?? []).map((r) => ({ k: r.order_type_id }))),
    carriers: tally((shp.data ?? []).map((r) => ({ k: r.carrier_id }))),
  };
}

async function main() {
  console.log("\nMontando a fila de revisão (nada é gravado)…\n");
  const [{ resources: plans }, uso] = await Promise.all([runSync(sb, { commit: false }), contarUso()]);

  const candidatos = plans.flatMap((p) => p.quaseCasam.map((q) => ({ ...q, table: p.table })));
  if (!candidatos.length) {
    console.log("Nenhum candidato.");
    return;
  }

  // contexto das fábricas: categorias + cidade, dos dois lados
  const suppliers = await gssGet<GssSupplier[]>(GSS_ENDPOINTS.supplier);
  const sc = await gssGet<GssSupplierCategory[]>(GSS_ENDPOINTS.supplierCategory);
  const gssCats = new Map<number, string[]>(); // supplier id → categorias
  const gssCidade = new Map<number, string>();
  if (sc.ok) {
    for (const row of sc.data) {
      (gssCats.get(row.supplier) ?? gssCats.set(row.supplier, []).get(row.supplier)!).push(row.category_name);
      if (row.city_name && !gssCidade.has(row.supplier)) gssCidade.set(row.supplier, row.city_name);
    }
  }
  const gssCompany = new Map<number, string>();
  if (suppliers.ok) for (const s of suppliers.data) gssCompany.set(s.id, s.company_name);

  const [{ data: cf }, { data: cats }] = await Promise.all([
    sb.from("category_factories").select("category_id, factory_id"),
    sb.from("categories").select("id, name"),
  ]);
  const nomeCat = new Map((cats ?? []).map((c) => [c.id, c.name]));
  const localCats = new Map<string, string[]>();
  for (const r of cf ?? []) {
    (localCats.get(r.factory_id) ?? localCats.set(r.factory_id, []).get(r.factory_id)!).push(nomeCat.get(r.category_id) ?? "?");
  }

  const usoDe = (table: string, id: string): number =>
    table === "factories" ? uso.factories.get(id) ?? 0
    : table === "clients" ? uso.clients.get(id) ?? 0
    : table === "carriers" ? uso.carriers.get(id) ?? 0
    : table === "order_types" ? uso.orderTypes.get(id) ?? 0
    : 0;

  const rotulo = (t: string) => (t === "factories" ? "pedidos" : t === "clients" || t === "order_types" ? "orders" : t === "carriers" ? "embarques" : "usos");

  let n = 0;
  for (const c of candidatos) {
    n++;
    console.log(`${String(n).padStart(2)}. [${c.table}] score ${c.score.toFixed(2)}`);
    console.log(`    GSS   : "${c.gssName}"  (id ${c.gssId})`);
    console.log(`    nosso : "${c.localName}"  — ${usoDe(c.table, c.localId)} ${rotulo(c.table)}`);
    if (c.emailBate !== null) console.log(`    email : ${c.emailBate ? "BATE" : "difere"}`);
    if (c.table === "factories") {
      const gid = Number(c.gssId);
      const gc = [...new Set(gssCats.get(gid) ?? [])];
      const lc = [...new Set(localCats.get(c.localId) ?? [])];
      const comuns = gc.filter((x) => lc.some((y) => y.toLowerCase() === x.toLowerCase()));
      console.log(`    cat GSS  : ${gc.join(", ") || "—"}${gssCidade.get(gid) ? `   [cidade: ${gssCidade.get(gid)}]` : ""}`);
      console.log(`    cat nossa: ${lc.join(", ") || "—"}`);
      console.log(`    → ${comuns.length ? `${comuns.length} categoria(s) em comum: ${comuns.join(", ")}` : "NENHUMA categoria em comum"}`);
      if (gssCompany.get(gid)) console.log(`    company GSS: ${gssCompany.get(gid)}`);
    }
    console.log("");
  }
  console.log(`${candidatos.length} candidatos. Nada gravado.`);
}

main().catch((e) => {
  console.error("FALHOU:", e);
  process.exit(1);
});
