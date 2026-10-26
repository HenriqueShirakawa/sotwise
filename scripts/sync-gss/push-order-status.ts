/**
 * Status das Orders do SOTWISE → GSS (`PATCH /orders/{id}/`), em lote — a mesma
 * lógica do webhook do app (lib/gss/outbound/order-status.ts). Serve para a
 * carga do que já existe e para conferir o que iria.
 *
 *   npx tsx scripts/sync-gss/push-order-status.ts --only 1705           # DRY: o que iria, nada enviado
 *   npx tsx scripts/sync-gss/push-order-status.ts --only 1705 --commit  # envia
 *   npx tsx scripts/sync-gss/push-order-status.ts --all                 # DRY de todas as orders ativas
 *
 * Sem `--only` exige `--all` (são milhares de GETs no GSS). Só faz PATCH do que
 * difere; order inexistente lá sai "skipped".
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";
import { pushOrderStatuses } from "../../lib/gss/outbound/order-status";

const argv = process.argv.slice(2);
const COMMIT = argv.includes("--commit");
const ALL = argv.includes("--all");
const onlyIdx = argv.indexOf("--only");
const ONLY = onlyIdx >= 0 ? (argv[onlyIdx + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean) : [];

const db = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  if (!ONLY.length && !ALL) {
    console.log("Passe --only <po,po> ou --all.");
    process.exit(1);
  }
  let query = db.from("orders").select("id").is("deleted_at", null);
  if (ONLY.length) query = query.in("po_number", ONLY);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((o) => o.id);
  console.log(`${ids.length} order(s) — ${COMMIT ? "ENVIANDO" : "dry, nada enviado"}\n`);

  const tally: Record<string, number> = {};
  for (let i = 0; i < ids.length; i += 50) {
    for (const p of await pushOrderStatuses(db, ids.slice(i, i + 50), { dry: !COMMIT })) {
      tally[p.outcome] = (tally[p.outcome] ?? 0) + 1;
      if (p.outcome === "same") continue;
      const call = p.call ? ` ${p.call.method} ${p.call.path} → ${p.result?.status ?? "-"}` : "";
      const why = p.reason ?? (p.result && p.result.kind !== "ok" ? p.result.error ?? p.result.text : "");
      console.log(`${p.label}:${call} (${p.outcome})${why ? ` ${why}` : ""}`);
    }
  }
  console.log("\n", tally);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
