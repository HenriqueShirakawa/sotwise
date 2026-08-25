/**
 * Sondagem SÓ-LEITURA: definições (Swagger 2.0) da Order do GSS e schemas
 * aninhados — para achar os nomes de campo, em especial a linha Factory×Category
 * e se referencia o supplier-category.
 *
 *   npx tsx scripts/sync-gss/probe-orders.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { gssGet } from "../../lib/gss/client";

type Swagger = { definitions?: Record<string, unknown> };

function dump(v: unknown, max = 8000): string {
  const s = JSON.stringify(v, null, 2);
  return s.length > max ? s.slice(0, max) + "\n… (truncado)" : s;
}

async function main() {
  const r = await gssGet<Swagger>("/openapi.json");
  if (!r.ok) {
    console.log("❌ openapi.json →", r.error);
    return;
  }
  const defs = r.data.definitions ?? {};
  const names = Object.keys(defs);
  console.log(`=== ${names.length} definitions ===`);
  console.log(names.join(", "));

  const rel = names.filter((n) => /order|factory|categor|supplier|batch|item|lot|schedule|product/i.test(n));
  console.log(`\n=== relacionados (${rel.length}): ${rel.join(", ")} ===`);

  for (const n of rel) {
    console.log(`\n----- ${n} -----`);
    console.log(dump(defs[n], 4000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
