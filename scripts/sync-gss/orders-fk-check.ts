/**
 * Conferência SÓ-LEITURA da Order do GSS contra as nossas bibliotecas.
 *
 * Desde a atualização do swagger deles (2026-09-01) a `Order` deixou de expor só
 * os `*_name` e passou a trazer os IDs das FKs (`customer`, `exporter`,
 * `consignee`, `importer`, `pod`, `business_unit`, `order_type`,
 * `sales_representative`, `leader`). Este script responde à pergunta prática:
 * **se uma order chegar com esses IDs, conseguimos resolver cada um no nosso
 * lado pela coluna `gss_id`?**
 *
 * Para cada FK: puxa o endpoint-fonte no GSS, cruza os ids com os `gss_id` já
 * pareados aqui e lista os que NÃO resolvem (esses derrubariam o POST inbound
 * com 400). Também tenta `GET /orders/` — hoje 403, o usuário técnico não tem
 * `orders.view_order`.
 *
 * Nada é escrito. Rodar de máquina allowlistada no Cloudflare do GSS.
 *
 *   npx tsx scripts/sync-gss/orders-fk-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { gssGet } from "../../lib/gss/client";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
}) as any;

/** `gss_id` → nome, só linhas vivas da biblioteca. */
async function pareados(table: string): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select("id, name, gss_id")
      .is("deleted_at", null)
      .not("gss_id", "is", null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const r of data ?? []) m.set(String(r.gss_id), r.name);
    if (!data || data.length < PAGE) break;
  }
  return m;
}

/** Campo da Order do GSS → endpoint-fonte → biblioteca nossa (null = não temos). */
const FKS: { campo: string; endpoint: string; tabela: string | null }[] = [
  { campo: "customer", endpoint: "/core/customer/", tabela: "clients" },
  { campo: "exporter", endpoint: "/core/exporter/", tabela: "exporters" },
  { campo: "order_type", endpoint: "/core/order-type/", tabela: "order_types" },
  { campo: "business_unit", endpoint: "/core/business-unit/", tabela: "business_units" },
  { campo: "pod", endpoint: "/core/port/", tabela: "pods" },
  { campo: "consignee / importer", endpoint: "/core/company/", tabela: "contacts" },
  { campo: "sales_representative", endpoint: "/core/sales-representative/", tabela: null },
];

const nomeDe = (x: Record<string, unknown>) => String(x.name ?? x.company_name ?? "");

async function main() {
  console.log("\n== Order do GSS × bibliotecas do SOTWISE (só leitura) ==");

  for (const fk of FKS) {
    const r = await gssGet<Record<string, unknown>[]>(fk.endpoint);
    if (!r.ok) {
      console.log(`\n### ${fk.campo} — ERRO ${r.error}`);
      continue;
    }
    const meus = fk.tabela ? await pareados(fk.tabela) : new Map<string, string>();
    const faltando = r.data.filter((x) => !meus.has(String(x.id)));
    console.log(`\n### ${fk.campo}  (${fk.endpoint} → ${fk.tabela ?? "SEM TABELA NOSSA"})`);
    console.log(`GSS ${r.data.length} | resolvem ${r.data.length - faltando.length} | NÃO resolvem ${faltando.length}`);
    for (const f of faltando.slice(0, 20)) console.log(`   ✗ id=${f.id}  ${nomeDe(f)}`);
    if (faltando.length > 20) console.log(`   … +${faltando.length - 20}`);
  }

  console.log("\n### orders (leitura ao vivo)");
  for (const p of ["/orders/", "/orders/1/items/"]) {
    const r = await gssGet<unknown>(p);
    console.log(r.ok ? `   ${p} OK` : `   ${p} → ${r.error.slice(0, 120)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
