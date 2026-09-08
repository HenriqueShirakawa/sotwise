/**
 * Mesma contagem de `contagens.sql`, mas pela Management API (PAT) em vez de
 * `psql` — para o lado da ORIGEM, quando não há a senha do Postgres (ver
 * via-api-dump.ts). Saída no mesmo formato `tabela|contagem` que o
 * `\pset unaligned` do `contagens.sql` produz, para o `diff` entre os dois
 * lados continuar funcionando linha a linha.
 *
 *   npx tsx scripts/migrate-project/contagens-via-api.ts > origem.txt
 */
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

// Mesma query de contagens.sql — mantida em sincronia manualmente com aquele
// arquivo (o lado do destino continua usando `psql -f contagens.sql`).
const QUERY = `
select tabela, contagem
from (
  select
    format('%s.%s', table_schema, table_name) as tabela,
    (xpath(
      '/row/c/text()',
      query_to_xml(
        format('select count(*) as c from %I.%I', table_schema, table_name),
        false, true, ''
      )
    ))[1]::text::bigint as contagem
  from information_schema.tables
  where table_type = 'BASE TABLE'
    and (
      table_schema = 'public'
      or (table_schema = 'auth'    and table_name in ('users', 'identities'))
      or (table_schema = 'storage' and table_name in ('buckets', 'objects'))
    )
) t
order by tabela;
`;

async function main() {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY }),
  });
  if (!res.ok) throw new Error(`Management API ${res.status}: ${await res.text()}`);
  const rows: { tabela: string; contagem: number }[] = await res.json();
  for (const r of rows) console.log(`${r.tabela}|${r.contagem}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
