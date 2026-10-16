/**
 * ETD Factories do SOTWISE → GSS (`/shipments/etd-factories/`), em lote — a
 * mesma lógica que o save da tela usa (lib/gss/outbound/etd-factory.ts).
 * Serve para a carga do que já existe e para conferir o que iria.
 *
 *   npx tsx scripts/sync-gss/push-etd-factories.ts                 # DRY: o que iria, nada enviado
 *   npx tsx scripts/sync-gss/push-etd-factories.ts --only 1705     # só as linhas da Order 1705
 *   npx tsx scripts/sync-gss/push-etd-factories.ts --commit        # envia
 *
 * Só entram linhas cujo lote tem `gss_id` (existe no GSS) e com ETD gravado.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";
import { pushEtdFactory, type EtdFactoryPush } from "../../lib/gss/outbound/etd-factory";

const argv = process.argv.slice(2);
const COMMIT = argv.includes("--commit");
const onlyIdx = argv.indexOf("--only");
const ONLY = onlyIdx >= 0 ? (argv[onlyIdx + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean) : [];

const db = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function candidateLines(): Promise<string[]> {
  const { data, error } = await db
    .from("order_factory_category")
    .select("id, batches!inner(gss_id, orders!inner(po_number)), etd_info!inner(id)")
    .not("batches.gss_id", "is", null)
    .returns<{ id: string; batches: { orders: { po_number: string } } }[]>();
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((r) => !ONLY.length || ONLY.includes(r.batches.orders.po_number))
    .map((r) => r.id);
}

function describe(p: EtdFactoryPush): string {
  switch (p.outcome) {
    case "skipped":
      return `pula: ${p.reason}`;
    case "unchanged":
      return `${p.label}: igual no GSS (id ${p.remoteId})`;
    case "planned":
      return `${p.label}: ${p.call.method} ${p.call.path} ${JSON.stringify(p.call.body)}`;
    case "called":
      return `${p.label}: ${p.call.method} ${p.call.path} → ${p.result.status} (${p.result.kind})${
        p.result.kind === "ok" ? "" : ` ${p.result.error ?? p.result.text}`
      }`;
  }
}

async function main() {
  const ids = await candidateLines();
  console.log(`${ids.length} linha(s) com lote do GSS e ETD gravado${ONLY.length ? ` (orders ${ONLY.join(", ")})` : ""}\n`);
  const tally: Record<string, number> = {};
  for (const id of ids) {
    const push = await pushEtdFactory(db, id, { dry: !COMMIT });
    const key = push.outcome === "called" ? `${push.call.method} ${push.result.kind}` : push.outcome;
    tally[key] = (tally[key] ?? 0) + 1;
    console.log(`• ${describe(push)}`);
  }
  console.log(`\n${JSON.stringify(tally)}${COMMIT ? "" : "\n(dry — nada enviado; --commit envia)"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
