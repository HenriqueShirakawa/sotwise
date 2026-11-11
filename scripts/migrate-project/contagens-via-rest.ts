/**
 * Conferência origem × destino sem PAT (27/10/2026): contagem exata de cada
 * tabela do `public` do destino, nos dois lados, pela API REST (service role).
 * Imprime só as diferenças; "(idênticos)" quando bate tudo.
 *
 *   npx tsx scripts/migrate-project/contagens-via-rest.ts <tabelas.json>
 */
import { readFileSync } from "node:fs";
import { config } from "dotenv";
config({ path: ".env.migracao" });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente ausente: ${name} (ver .env.migracao)`);
  return v;
}

const sides = {
  origem: { url: required("SRC_SUPABASE_URL"), key: required("SRC_SERVICE_ROLE_KEY") },
  destino: { url: required("DST_SUPABASE_URL"), key: required("DST_SERVICE_ROLE_KEY") },
};

async function count(side: { url: string; key: string }, table: string): Promise<number | null> {
  const res = await fetch(`${side.url}/rest/v1/${table}?select=*`, {
    method: "HEAD",
    headers: { apikey: side.key, Authorization: `Bearer ${side.key}`, Prefer: "count=exact" },
  });
  if (res.status === 404) return null;
  const range = res.headers.get("content-range") ?? "";
  return Number(range.split("/")[1] ?? NaN);
}

async function main() {
  const tables = (JSON.parse(readFileSync(process.argv[2], "utf8")) as { table: string }[]).map(
    (t) => t.table
  );
  let diffs = 0;
  for (const t of tables) {
    const [o, d] = await Promise.all([count(sides.origem, t), count(sides.destino, t)]);
    if (o === null && d === 0) continue; // só existe no destino, vazia
    if (o !== d) {
      diffs++;
      console.log(`${t}: origem ${o ?? "—"} · destino ${d}`);
    }
  }
  console.log(diffs ? `${diffs} tabela(s) diferentes` : "(idênticos)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
