/**
 * Variante de `via-api-dump.ts` SEM o PAT da origem (27/10/2026): lê as tabelas
 * do `public` da ORIGEM pela API REST (PostgREST + service role) e gera o mesmo
 * SQL `insert ... jsonb_populate_recordset` para carregar no destino por psql.
 *
 * O que muda em relação ao via-api-dump:
 *  - NÃO lê `auth` (a API REST não alcança). Os usuários do destino ficam como
 *    estão; os que faltarem são criados à parte (criar-usuarios-faltantes.ts).
 *  - A lista de tabelas e colunas vem do DESTINO, depois que as migrations já
 *    foram aplicadas nele (psql). Só entram no INSERT as colunas que existem nos
 *    dois lados — coluna que a origem não tem fica com o DEFAULT do destino.
 *
 *   npx tsx scripts/migrate-project/via-rest-dump.ts <tabelas.json> <saida-dados.sql>
 *
 * <tabelas.json> = [{ table, columns: [...], pk: [...] }] gerado pelo
 * espelhar-sem-pat.sh a partir do information_schema do destino.
 * Lê SRC_SUPABASE_URL e SRC_SERVICE_ROLE_KEY de `.env.migracao`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
config({ path: ".env.migracao" });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente ausente: ${name} (ver .env.migracao)`);
  return v;
}

const SRC_URL = required("SRC_SUPABASE_URL");
const SRC_KEY = required("SRC_SERVICE_ROLE_KEY");
const PAGE = 1000;

type TableInfo = { table: string; columns: string[]; pk: string[] };

const headers = { apikey: SRC_KEY, Authorization: `Bearer ${SRC_KEY}` };

/** Lê a tabela inteira da origem, paginando em ordem estável (PK ou todas as colunas). */
async function readAll(t: TableInfo): Promise<Record<string, unknown>[] | null> {
  const order = (t.pk.length ? t.pk : t.columns).map((c) => `${c}.asc`).join(",");
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(
      `${SRC_URL}/rest/v1/${t.table}?select=*&order=${encodeURIComponent(order)}`,
      { headers: { ...headers, Range: `${from}-${from + PAGE - 1}`, "Range-Unit": "items" } }
    );
    // Tabela que só existe no destino (migration ainda não aplicada na origem).
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`REST ${res.status} em ${t.table}: ${await res.text()}`);
    const page = (await res.json()) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function main() {
  const [, , inTables, outDados] = process.argv;
  if (!inTables || !outDados) {
    console.error("uso: via-rest-dump.ts <tabelas.json> <saida-dados.sql>");
    process.exit(2);
  }
  const tables = JSON.parse(readFileSync(inTables, "utf8")) as TableInfo[];
  console.log(`[rest] ${tables.length} tabela(s) no destino; lendo da origem ${SRC_URL}`);

  let sql = "";
  const soNoDestino: string[] = [];
  for (const [i, t] of tables.entries()) {
    process.stdout.write(`  (${i + 1}/${tables.length}) ${t.table}... `);
    const rows = await readAll(t);
    if (rows === null) {
      soNoDestino.push(t.table);
      console.log("não existe na origem (fica vazia)");
      continue;
    }
    if (rows.length === 0) {
      console.log("0");
      continue;
    }
    const sourceCols = new Set(Object.keys(rows[0]));
    const cols = t.columns.filter((c) => sourceCols.has(c));
    const faltando = t.columns.filter((c) => !sourceCols.has(c));
    const listaCols = cols.map((c) => `"${c}"`).join(", ");
    const tag = `Q_${t.table}`.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    sql +=
      `-- public.${t.table}: ${rows.length} linha(s)${faltando.length ? ` (default no destino: ${faltando.join(", ")})` : ""}\n` +
      // OVERRIDING SYSTEM VALUE: tabelas com id `generated always as identity`
      // (ex.: gss_call_log) recusam o id da origem sem isso.
      `insert into public."${t.table}" (${listaCols}) overriding system value\n` +
      `select ${listaCols} from jsonb_populate_recordset(null::public."${t.table}", $${tag}$${JSON.stringify(rows)}$${tag}$::jsonb) as t;\n\n`;
    console.log(`${rows.length}${faltando.length ? ` (default: ${faltando.join(", ")})` : ""}`);
  }
  writeFileSync(outDados, sql, "utf8");
  if (soNoDestino.length) console.log(`\nSó no destino (vazias): ${soNoDestino.join(", ")}`);
  console.log(`\nGerado: ${outDados}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
