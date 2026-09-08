/**
 * Gera os arquivos de dados (auth + public) do espelho lendo a ORIGEM pela
 * Management API do Supabase (Personal Access Token), em vez de `pg_dump`.
 *
 * Por que existe: `pg_dump`/`psql` exigem a senha do Postgres da origem, e
 * essa senha só Owner/Admin da org consegue ver ou resetar — um Developer
 * (que já tem acesso de sobra ao SQL Editor do dashboard) não. A Management
 * API roda a MESMA query que o SQL Editor rodaria, autenticada por PAT em vez
 * de senha de banco — dá pra ler QUALQUER schema, incluindo `auth`.
 *
 * A técnica: para cada tabela, um `INSERT ... SELECT * FROM
 * jsonb_populate_recordset(null::schema.tabela, '<json>'::jsonb)`. É o
 * Postgres quem faz a conversão JSON -> tipo de coluna (uuid, timestamptz,
 * jsonb, array, enum) pela função de input de cada tipo — não precisamos
 * serializar campo a campo como um `pg_dump` faria.
 *
 *   npx tsx scripts/migrate-project/via-api-dump.ts <saida-auth.sql> <saida-dados.sql>
 *
 * Lê SRC_SUPABASE_URL e SUPABASE_PAT de `.env.migracao`.
 */
import { writeFileSync } from "node:fs";
import { config } from "dotenv";
config({ path: ".env.migracao" });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente ausente: ${name} (ver .env.migracao)`);
  return v;
}

const PAT = required("SUPABASE_PAT");
const SRC_URL = required("SRC_SUPABASE_URL");
const PROJECT_REF = new URL(SRC_URL).hostname.split(".")[0];
const MGMT_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

async function query(sql: string): Promise<any[]> {
  const res = await fetch(MGMT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    throw new Error(`Management API ${res.status} (query: ${sql.slice(0, 80)}...): ${await res.text()}`);
  }
  return res.json();
}

/**
 * `jsonb_populate_recordset(null::schema.tabela, ...)` sempre monta um
 * registro com TODAS as colunas do tipo da tabela — as ausentes no JSON
 * viram NULL, mas continuam fazendo parte da linha. Então `insert ... select
 * *` mira a coluna gerada (ex.: `auth.users.confirmed_at`,
 * `auth.identities.email`) por posição mesmo sem ela aparecer no JSON, e o
 * Postgres recusa (não se pode escrever em `generated always as`, nem NULL).
 * A saída é listar as colunas explicitamente — no INSERT e no SELECT — de
 * fora as geradas.
 */
async function colunasInseriveis(schema: string, tabela: string): Promise<string[]> {
  const rows = await query(
    `select column_name from information_schema.columns where table_schema='${schema}' and table_name='${tabela}' and is_generated <> 'ALWAYS' order by ordinal_position`
  );
  return rows.map((r) => r.column_name);
}

/** Um bloco `insert ... jsonb_populate_recordset` para uma tabela inteira. */
async function inserirTabela(schema: string, tabela: string): Promise<string> {
  const colunas = await colunasInseriveis(schema, tabela);
  const listaCols = colunas.map((c) => `"${c}"`).join(", ");

  const sql = `select coalesce(jsonb_agg(t), '[]'::jsonb) as data from ${schema}."${tabela}" t`;
  const [{ data }] = await query(sql);
  const linhas = Array.isArray(data) ? data.length : 0;
  if (linhas === 0) return `-- ${schema}.${tabela}: 0 linha(s), nada a inserir\n\n`;

  // Tag do dollar-quoting única por tabela — evita ter que escapar aspas
  // dentro do JSON (que pode ter texto livre do usuário).
  const tag = `Q_${schema}_${tabela}`.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  const json = JSON.stringify(data);
  return (
    `-- ${schema}.${tabela}: ${linhas} linha(s)\n` +
    `insert into ${schema}."${tabela}" (${listaCols})\n` +
    `select ${listaCols} from jsonb_populate_recordset(null::${schema}."${tabela}", $${tag}$${json}$${tag}$::jsonb) as t;\n\n`
  );
}

async function main() {
  const [, , outAuth, outDados] = process.argv;
  if (!outAuth || !outDados) {
    console.error("uso: via-api-dump.ts <saida-auth.sql> <saida-dados.sql>");
    process.exit(2);
  }

  console.log(`[api] projeto origem: ${PROJECT_REF}`);

  console.log("[api] auth.users + auth.identities...");
  const authSql =
    (await inserirTabela("auth", "users")) + (await inserirTabela("auth", "identities"));
  writeFileSync(outAuth, authSql, "utf8");

  console.log("[api] listando tabelas do public...");
  const tabelas: string[] = (
    await query(
      `select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1`
    )
  ).map((r) => r.table_name);
  console.log(`[api] ${tabelas.length} tabela(s) no public`);

  let dadosSql = "";
  for (const [i, t] of tabelas.entries()) {
    process.stdout.write(`  (${i + 1}/${tabelas.length}) ${t}... `);
    dadosSql += await inserirTabela("public", t);
    console.log("ok");
  }
  writeFileSync(outDados, dadosSql, "utf8");

  console.log(`\nGerado: ${outAuth}, ${outDados}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
