/**
 * CLI da via de saída SOTWISE → GSS (fila `gss_outbound`, INTEGRACAO_GSS §10).
 * A lógica vive em `lib/gss/outbound/` — a mesma que as actions e o cron usam.
 *
 *   npx tsx scripts/sync-gss/push-outbound.ts                       # DRY: fila + payloads, nada enviado
 *   npx tsx scripts/sync-gss/push-outbound.ts --enqueue 1306 --dry  # enfileira o PL 1306 e mostra o payload
 *   npx tsx scripts/sync-gss/push-outbound.ts --commit              # drena a fila (envia ao GSS)
 *
 * `--commit` envia mesmo com GSS_OUTBOUND_ENABLED desligada: é uma ação
 * deliberada de quem roda o CLI. A chave só segura o envio automático do app.
 * `--enqueue` aceita vários números separados por vírgula (backfill à mão).
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";
import { dispatchGssOutbound } from "../../lib/gss/outbound/dispatch";
import { pushPlShipment } from "../../lib/gss/outbound/pl-shipment";

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const COMMIT = has("--commit");
const enqueueIdx = argv.indexOf("--enqueue");
const ENQUEUE = enqueueIdx >= 0 ? (argv[enqueueIdx + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean) : [];

const db = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function enqueue(plNumbers: string[]): Promise<void> {
  for (const pl of plNumbers) {
    const { data, error } = await db
      .from("pre_loadings")
      .select("id")
      .eq("pl_number", pl)
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !data) {
      console.log(`✗ PL ${pl}: ${error?.message ?? "não encontrado"}`);
      continue;
    }
    const { error: rpcError } = await db.rpc("enqueue_gss_outbound", { p_kind: "pl_shipment", p_entity_id: data.id });
    console.log(rpcError ? `✗ PL ${pl}: ${rpcError.message}` : `✓ PL ${pl} enfileirado`);
  }
}

async function showQueue(): Promise<void> {
  const { data, error } = await db
    .from("gss_outbound")
    .select("id, kind, entity_id, status, attempts, next_attempt_at, last_error")
    .in("status", ["pending", "sending"])
    .order("next_attempt_at");
  if (error) {
    console.log(`✗ gss_outbound: ${error.message}`);
    return;
  }
  console.log(`\n=== fila: ${data.length} pendente(s) ===`);
  for (const row of data) {
    const push = await pushPlShipment(db, row.entity_id, { dry: true });
    console.log(`\n• ${row.kind} ${row.entity_id} [${row.status}, tentativas ${row.attempts}]${row.last_error ? ` — último erro: ${row.last_error}` : ""}`);
    if (push.outcome === "skipped") console.log(`  pula: ${push.reason}`);
    if (push.outcome === "planned") {
      console.log(`  ${push.patch.method} ${push.patch.path} ${JSON.stringify(push.patch.body)}`);
      console.log(
        push.createIfMissing
          ? `  se 404 → ${push.createIfMissing.method} ${push.createIfMissing.path} ${JSON.stringify(push.createIfMissing.body)}`
          : "  se 404 → não cria (embarque cancelado)"
      );
    }
  }
}

async function main() {
  if (ENQUEUE.length) await enqueue(ENQUEUE);

  if (!COMMIT) {
    await showQueue();
    console.log("\n(dry — nada enviado; --commit envia)");
    return;
  }

  const result = await dispatchGssOutbound(db, { force: true, maxRounds: 20 });
  console.log(
    `\nenviados ${result.sent} · falhas ${result.failed} · pulados ${result.skipped} · adiados ${result.postponed} (de ${result.claimed})`
  );
  for (const e of result.errors) console.log(`  ✗ ${e}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
