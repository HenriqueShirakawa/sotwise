/**
 * Gera o SNAPSHOT de leitura do GSS para o painel /access/gss (INTEGRACAO_GSS §9.9).
 *
 * Por que existe: o Cloudflare do GSS desafia IPs de datacenter (a Vercel) com
 * página de challenge, mesmo com o service token correto — fator de segurança
 * deles. Da nossa máquina (IP allowlistado) os mesmos headers passam. Então este
 * script — rodado DAQUI, não da Vercel — lê a API e espelha a resposta crua nas
 * tabelas `gss_snapshot` / `gss_snapshot_runs`; o painel na Vercel lê o espelho.
 *
 *   npx tsx scripts/sync-gss/snapshot.ts                 # todos os recursos
 *   npx tsx scripts/sync-gss/snapshot.ts city customer   # só os listados
 *
 * NÃO alimenta as bibliotecas (isso é `scripts/sync-gss/sync.ts`); é só a foto
 * da origem para diagnóstico. Idempotente: substitui o espelho de cada recurso.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";
import { gssGet } from "../../lib/gss/client";
import { RECURSOS } from "../../lib/gss/recursos";

const supabase = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const INSERT_CHUNK = 500;

async function snapshotOne(key: string, endpoint: string): Promise<void> {
  const recurso = RECURSOS.find((r) => r.key === key)!;
  const runAt = new Date().toISOString();

  const resposta = await gssGet<Record<string, unknown>[]>(endpoint);
  if (!resposta.ok) {
    // Falhou a leitura: registra a tentativa e PRESERVA o espelho anterior.
    await supabase.from("gss_snapshot_runs").upsert(
      { resource: key, fetched_at: runAt, count: 0, ok: false, error: resposta.error },
      { onConflict: "resource" }
    );
    console.log(`${key.padEnd(14)} FALHOU  ${resposta.error}`);
    return;
  }

  const itens = resposta.data.filter((it) => it && it.id != null);
  const linhas = itens.map((it) => ({
    resource: key,
    gss_id: Number(it.id),
    payload: it,
    fetched_at: runAt,
  }));

  // Substitui o espelho do recurso: apaga o que havia e insere o atual. A janela
  // vazia é de milissegundos e a tela é de diagnóstico, rodada de vez em quando.
  const del = await supabase.from("gss_snapshot").delete().eq("resource", key);
  if (del.error) throw new Error(`delete ${key}: ${del.error.message}`);

  for (let i = 0; i < linhas.length; i += INSERT_CHUNK) {
    const chunk = linhas.slice(i, i + INSERT_CHUNK);
    const ins = await supabase.from("gss_snapshot").insert(chunk);
    if (ins.error) throw new Error(`insert ${key} [${i}]: ${ins.error.message}`);
  }

  await supabase.from("gss_snapshot_runs").upsert(
    { resource: key, fetched_at: runAt, count: linhas.length, ok: true, error: null },
    { onConflict: "resource" }
  );
  console.log(`${key.padEnd(14)} ok      ${linhas.length} registros → ${recurso.table}`);
}

async function main() {
  const pedidos = process.argv.slice(2);
  const alvo = pedidos.length
    ? RECURSOS.filter((r) => pedidos.includes(r.key))
    : RECURSOS;

  if (!alvo.length) {
    console.error(`Nenhum recurso casou. Válidos: ${RECURSOS.map((r) => r.key).join(", ")}`);
    process.exit(1);
  }

  console.log(`\n== Snapshot GSS → Supabase  (${alvo.length} recurso(s)) ==\n`);
  for (const r of alvo) await snapshotOne(r.key, r.endpoint);
  console.log("\nPronto. O painel /access/gss já lê deste espelho.");
}

main().catch((e) => {
  console.error("FALHOU:", e);
  process.exit(1);
});
