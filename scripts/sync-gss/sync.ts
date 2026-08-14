/**
 * CLI do sync GSS → SOTWISE. A lógica toda vive em `lib/gss/sync.ts`, que a rota
 * do cron (`app/api/cron/gss-sync`) também usa — aqui só ficam argumentos e
 * impressão.
 *
 *   npx tsx scripts/sync-gss/sync.ts                        # DRY-RUN (só o plano)
 *   npx tsx scripts/sync-gss/sync.ts --dupes                # + fila de merge completa
 *   npx tsx scripts/sync-gss/sync.ts --commit --pair-only   # só os vínculos
 *   npx tsx scripts/sync-gss/sync.ts --commit --insert=countries,cities
 *   npx tsx scripts/sync-gss/sync.ts --commit               # tudo (pols segue bloqueado)
 *   npx tsx scripts/sync-gss/sync.ts --commit --soft-delete # + apaga o que sumiu do GSS
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";
import { runSync, willInsert, type ResourcePlan, type SyncOptions } from "../../lib/gss/sync";

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);

const insertArg = argv.find((a) => a.startsWith("--insert="));
const opts: SyncOptions = {
  commit: has("--commit"),
  pairOnly: has("--pair-only"),
  insertOnly: insertArg
    ? new Set(insertArg.slice("--insert=".length).split(",").map((s) => s.trim()).filter(Boolean))
    : null,
  allowPolInserts: has("--allow-pol-inserts"),
  softDelete: has("--soft-delete"),
  forceCasing: has("--force-casing"),
};
const SHOW_DUPES = has("--dupes");

const supabase = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const pad = (s: string | number, n: number) => String(s).padStart(n);

function logPlan(p: ResourcePlan): void {
  const excess = p.localRows - p.localNames;
  console.log(
    `${p.table.padEnd(16)} rows ${pad(p.localRows, 4)}/names ${pad(p.localNames, 4)}${excess ? ` (+${excess} dup)` : "        "}` +
    `  match ${pad(p.matched, 4)}  link ${pad(p.links.length, 4)}  campos ${pad(p.fields.length, 4)}` +
    `  insert ${pad(p.inserts.length, 4)}${p.skippedInserts ? "↷" : " "} sumiu ${pad(p.missing.length, 3)}  dupes ${pad(p.dupesAll.length, 3)}  localOnly ${pad(p.localOnly, 4)}`
  );
  if (p.fields.length) {
    const sample = p.fields.slice(0, 5).map((f) => `${f.name} → ${JSON.stringify(f.changes)}`).join(", ");
    console.log(`   ↳ campos: ${sample}${p.fields.length > 5 ? ` … +${p.fields.length - 5}` : ""}`);
  }
  if (p.revives.length) console.log(`   ↳ revive: ${p.revives.slice(0, 5).map((r) => r.name).join(", ")}`);
  if (p.missing.length) {
    console.log(`   ↳ SUMIU do GSS: ${p.missing.slice(0, 8).map((m) => m.name).join(", ")}${p.missing.length > 8 ? " …" : ""}` +
      `${opts.softDelete ? "  (soft-delete APLICADO)" : "  (só relato; --soft-delete aplica)"}`);
  }
  if (p.table === "pols" && p.inserts.length && !opts.allowPolInserts && !opts.pairOnly) {
    console.log("   ⚠️  insert em pols bloqueado (§9.3 — granularidade cidade+porto); --allow-pol-inserts força");
  }
}

async function main() {
  const scope = opts.pairOnly ? "pair-only" : opts.insertOnly ? `insert=${[...opts.insertOnly].join(",")}` : "full";
  console.log(`\n== Sync GSS → SOTWISE  [${opts.commit ? "COMMIT" : "DRY-RUN"}, ${scope}${opts.softDelete ? ", soft-delete" : ""}] ==\n`);

  const plans = await runSync(supabase, opts);

  for (const p of plans) logPlan(p);

  if (SHOW_DUPES) {
    console.log("\n== fila de merge (grupos locais com nome repetido) ==");
    for (const p of plans) {
      if (!p.dupesAll.length) continue;
      console.log(`\n-- ${p.table} (${p.dupesAll.length} grupos)`);
      for (const d of p.dupesAll) console.log(`   ${d.name} (${d.ids.length}×)  ${d.ids.join(" ")}`);
    }
  }

  const sum = (f: (p: ResourcePlan) => number) => plans.reduce((s, p) => s + f(p), 0);
  const insOn = sum((p) => (willInsert(p.table, opts) ? p.inserts.length : 0));
  const verb = opts.commit ? "GRAVADO" : "(dry-run)";
  console.log(
    `\nTOTAL ${verb}: link ${sum((p) => p.links.length)}, campos ${sum((p) => p.fields.length)}, ` +
    `revive ${sum((p) => p.revives.length)}, insert ${insOn}/${sum((p) => p.inserts.length)}, ` +
    `sumiu ${sum((p) => p.missing.length)}${opts.softDelete ? " (apagados)" : " (só relato)"}`
  );
  if (!opts.commit) console.log("Rode com --commit; restrinja com --pair-only ou --insert=countries,cities.");
}

main().catch((e) => {
  console.error("FALHOU:", e);
  process.exit(1);
});
