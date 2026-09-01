/**
 * Vínculo das ORDERS: `Order.id` do GSS  ↔  `orders.po_number` do SOTWISE.
 *
 * Decisão de 2026-09-01: o id da order no GSS é o mesmo número que aqui é o
 * `po_number`. Este script confere essa hipótese caso a caso e, com `--commit`,
 * grava `orders.gss_id = String(id do GSS)` — a chave natural que torna o
 * `POST /api/gss/orders` idempotente (ver 20260824120000_gss_orders_inbound.sql).
 *
 * NÃO grava nada sem `--commit`, e nunca sobrescreve um `gss_id` já preenchido
 * com valor diferente (isso vira conflito relatado, não update silencioso).
 *
 *   npx tsx scripts/sync-gss/orders-link-po.ts                 # DRY-RUN
 *   npx tsx scripts/sync-gss/orders-link-po.ts --commit        # aplica
 *   npx tsx scripts/sync-gss/orders-link-po.ts --from dump.json
 *
 * Fonte das orders do GSS: `GET /orders/`. Enquanto o usuário técnico não tiver
 * a permissão `orders.view_order` (hoje responde 403), use `--from <arquivo>`
 * com um dump JSON exportado por eles — array de objetos com pelo menos
 * `id`, e opcionalmente `customer_name` / `order_type_name` para conferência.
 *
 * ⚠️ Rodar o cruzamento ANTES de qualquer inbound de order: sem `gss_id`
 * gravado, um POST do GSS para uma order que já existe aqui tentaria CRIAR
 * outra e bateria na unique de `po_number` (409).
 */
import { readFileSync, writeFileSync } from "node:fs";

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { gssGet } from "../../lib/gss/client";

const COMMIT = process.argv.includes("--commit");
const FROM = (() => {
  const i = process.argv.indexOf("--from");
  return i >= 0 ? process.argv[i + 1] : null;
})();
/** Grava a conferência linha a linha num CSV, para revisar no Excel. */
const CSV = (() => {
  const i = process.argv.indexOf("--csv");
  return i >= 0 ? process.argv[i + 1] : null;
})();

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
}) as any;

type GssOrder = { id: number; customer_name?: string; order_type_name?: string; created_at?: string };
type Nossa = { id: string; po_number: string; gss_id: string | null; status: string };
type Linha = {
  gssId: string;
  customer: string;
  po: string;
  orderId: string;
  status: string;
  /** GRAVAR · JA OK · CONFLITO · SEM PAR AQUI (só no GSS) · SO AQUI (só no SOTWISE) */
  acao: string;
};

async function carregarGss(): Promise<GssOrder[]> {
  if (FROM) {
    const bruto = JSON.parse(readFileSync(FROM, "utf8"));
    const rows = Array.isArray(bruto) ? bruto : (bruto.results ?? []);
    console.log(`fonte: ${FROM} (${rows.length} orders)`);
    return rows as GssOrder[];
  }
  const r = await gssGet<GssOrder[] | { results: GssOrder[] }>("/orders/");
  if (!r.ok) {
    throw new Error(
      `GET /orders/ falhou: ${r.error}\n` +
        "Se for 403, o usuário técnico ainda não tem `orders.view_order` no GSS.\n" +
        "Alternativa: peça um dump JSON e rode com --from <arquivo>."
    );
  }
  const rows = Array.isArray(r.data) ? r.data : r.data.results;
  console.log(`fonte: GET /orders/ (${rows.length} orders)`);
  return rows;
}

async function carregarNossas(): Promise<Nossa[]> {
  const out: Nossa[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("orders")
      .select("id, po_number, gss_id, status")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`orders: ${error.message}`);
    out.push(...((data ?? []) as Nossa[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function main() {
  console.log(`\n== Vínculo orders: GSS.id ↔ po_number  [${COMMIT ? "COMMIT" : "DRY-RUN"}] ==\n`);

  const [gss, nossas] = await Promise.all([carregarGss(), carregarNossas()]);
  const porPo = new Map<string, Nossa>();
  for (const o of nossas) porPo.set(String(o.po_number), o);
  const idsGss = new Set(gss.map((o) => String(o.id)));

  const aGravar: { id: string; po: string; gssId: string }[] = [];
  const jaOk: string[] = [];
  const conflitos: string[] = [];
  const semParAqui: GssOrder[] = [];
  /** Uma linha por caso, para conferência ANTES de qualquer gravação. */
  const linhas: Linha[] = [];

  for (const g of gss) {
    const chave = String(g.id);
    const nossa = porPo.get(chave);
    if (!nossa) {
      semParAqui.push(g);
      linhas.push({ gssId: chave, customer: g.customer_name ?? "", po: "—", orderId: "—", status: "—", acao: "SEM PAR AQUI" });
      continue;
    }
    const base = { gssId: chave, customer: g.customer_name ?? "", po: nossa.po_number, orderId: nossa.id, status: nossa.status };
    if (nossa.gss_id === chave) {
      jaOk.push(chave);
      linhas.push({ ...base, acao: "JA OK" });
    } else if (nossa.gss_id) {
      conflitos.push(`po ${chave}: gss_id atual '${nossa.gss_id}' ≠ '${chave}'`);
      linhas.push({ ...base, acao: `CONFLITO (gss_id atual ${nossa.gss_id})` });
    } else {
      aGravar.push({ id: nossa.id, po: chave, gssId: chave });
      linhas.push({ ...base, acao: "GRAVAR" });
    }
  }

  const semParLa = nossas.filter((o) => !idsGss.has(String(o.po_number)));
  const bubbleId = semParLa.filter((o) => /x/.test(String(o.po_number)));
  for (const o of semParLa) {
    linhas.push({ gssId: "—", customer: "", po: o.po_number, orderId: o.id, status: o.status, acao: "SO AQUI" });
  }

  // Lista um a um — é o que se confere antes de liberar o --commit.
  console.log("\nGSS id   | customer                  | po_number  | status            | ação");
  console.log("---------+---------------------------+------------+-------------------+------------------------");
  for (const l of linhas) {
    console.log(
      `${l.gssId.padEnd(8)} | ${l.customer.slice(0, 25).padEnd(25)} | ${String(l.po).slice(0, 10).padEnd(10)} | ${l.status.padEnd(17)} | ${l.acao}`
    );
  }

  if (CSV) {
    const cab = "gss_id,customer,po_number,order_id,status,acao\n";
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    writeFileSync(CSV, cab + linhas.map((l) => [l.gssId, l.customer, l.po, l.orderId, l.status, l.acao].map(esc).join(",")).join("\n"), "utf8");
    console.log(`\ncsv → ${CSV} (${linhas.length} linhas)`);
  }

  console.log(`\ncasam (a gravar) .......... ${aGravar.length}`);
  console.log(`já vinculadas ............. ${jaOk.length}`);
  console.log(`conflito de gss_id ........ ${conflitos.length}`);
  console.log(`no GSS e não aqui ......... ${semParAqui.length}`);
  console.log(`aqui e não no GSS ......... ${semParLa.length}  (destas, ${bubbleId.length} têm id do Bubble como po_number)`);

  if (!COMMIT) {
    console.log("\n(dry-run — nada gravado; use --commit)");
    return;
  }
  if (conflitos.length) {
    console.log("\n❌ Há conflitos de gss_id. Resolva antes de gravar — abortando.");
    process.exit(1);
  }

  let n = 0;
  for (const a of aGravar) {
    const { error } = await db.from("orders").update({ gss_id: a.gssId }).eq("id", a.id);
    if (error) throw new Error(`po ${a.po}: ${error.message}`);
    if (++n % 100 === 0) console.log(`   ${n}/${aGravar.length}`);
  }
  console.log(`\n✅ ${n} orders vinculadas.`);
}

main().catch((e) => {
  console.error(String(e.message ?? e));
  process.exit(1);
});
