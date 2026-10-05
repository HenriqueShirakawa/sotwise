/**
 * CARGA INICIAL de `gss_id` em lotes e PLs/shipments (decisão de 2026-10-05).
 *
 * O GSS passou a ter lote (OrderBatch) e Shipment próprios. Daqui pra frente o
 * lote chega pelo WEBHOOK deles (`POST /api/batches` com `gss_id`) e o id do
 * Shipment é gravado a cada envio de datas (lib/gss/outbound/pl-shipment.ts).
 * Este script alimenta UMA VEZ o que já existe lá:
 *
 *  1. LOTES — `GET /orders/batch-totals/` (único endpoint do GSS que lista
 *     OrderBatch: id, batch_code, order_id). Cada lote vira um
 *     `POST {api}/api/batches` com `gss_id` — o MESMO caminho do webhook, então
 *     vale a regra de lá: lote já ligado → nada; lote com o mesmo número sem
 *     gss_id → adotado; senão → criado VAZIO (o GSS não expõe as linhas do
 *     lote), com rollup de status da Order. Precisa do app rodando (`--api`).
 *  2. SHIPMENTS — `GET /shipments/` (paginado) → `pre_loadings.gss_id` pelo
 *     `pl_number` numérico; o trigger leva para `shipments.gss_id`.
 *
 * NÃO grava nada sem `--commit`. Nunca sobrescreve gss_id diferente (relata).
 *
 *   npx tsx scripts/sync-gss/seed-batches-shipments.ts                          # DRY-RUN
 *   npx tsx scripts/sync-gss/seed-batches-shipments.ts --commit --api http://localhost:3000
 *
 * O `--api` recebe o token de `API_TOKEN` do `.env.local` — tem de ser o token
 * do ambiente apontado (o local usa o do .env.local; produção tem outro).
 * Requer a migration 20261005120000 aplicada.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

import type { Database } from "../../types/database";
import { gssGet } from "../../lib/gss/client";
import { numericPlNumber } from "../../lib/gss/outbound/pl-shipment";

const COMMIT = process.argv.includes("--commit");
const API = (() => {
  const i = process.argv.indexOf("--api");
  return (i >= 0 ? process.argv[i + 1] : "http://localhost:3000").replace(/\/$/, "");
})();

const db = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

type GssBatch = { batch_id: number; batch_code: string; order_id: number };
type GssShipment = { id: number; pl_number: number };
type Page<T> = { count: number; next: string | null; results: T[] };

async function seedBatches() {
  const r = await gssGet<GssBatch[]>("/orders/batch-totals/");
  if (!r.ok) throw new Error(`GSS /orders/batch-totals/: ${r.error}`);
  console.log(`\n== LOTES: ${r.data.length} no GSS`);

  for (const b of r.data) {
    const gssId = String(b.batch_id);
    const { data: linked } = await db
      .from("batches")
      .select("id, batch_number, order_id")
      .eq("gss_id", gssId)
      .maybeSingle();
    if (linked) {
      console.log(`  = ${b.batch_code} (gss ${gssId}) já ligado ao lote ${linked.id}`);
      continue;
    }

    const body = { gss_id: b.batch_id, order_gss_id: b.order_id, batch_number: b.batch_code };
    if (!COMMIT) {
      console.log(`  + ${b.batch_code} (gss ${gssId}) → POST /api/batches ${JSON.stringify(body)}`);
      continue;
    }
    const res = await fetch(`${API}/api/batches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as
      | { data?: { id: string; full_number: string; status: string }; error?: string }
      | null;
    if (json?.data) {
      console.log(`  ✓ ${b.batch_code} → ${res.status} lote ${json.data.id} (${json.data.full_number}, ${json.data.status})`);
    } else {
      console.log(`  ✗ ${b.batch_code} → ${res.status} ${json?.error ?? "sem corpo"}`);
    }
  }
}

async function fetchShipments(): Promise<GssShipment[]> {
  const all: GssShipment[] = [];
  for (let page = 1; ; page++) {
    const r = await gssGet<Page<GssShipment>>(`/shipments/?page=${page}&page_size=200`);
    if (!r.ok) throw new Error(`GSS /shipments/ página ${page}: ${r.error}`);
    all.push(...r.data.results);
    if (!r.data.next) return all;
  }
}

async function seedShipments() {
  const shipments = await fetchShipments();
  console.log(`\n== SHIPMENTS: ${shipments.length} no GSS`);

  for (const s of shipments) {
    const gssId = String(s.id);
    const { data: candidates, error } = await db
      .from("pre_loadings")
      .select("id, pl_number, gss_id")
      .ilike("pl_number", `%${s.pl_number}`)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    const matches = (candidates ?? []).filter((p) => numericPlNumber(p.pl_number) === s.pl_number);

    if (matches.length !== 1) {
      console.log(`  ? PL ${s.pl_number} (gss ${gssId}): ${matches.length} PLs casam aqui — pulado`);
      continue;
    }
    const pl = matches[0];
    if (pl.gss_id === gssId) {
      console.log(`  = PL ${s.pl_number} já ligado (gss ${gssId})`);
      continue;
    }
    if (pl.gss_id) {
      console.log(`  ! PL ${s.pl_number}: aqui gss_id=${pl.gss_id}, GSS diz ${gssId} — CONFLITO, não mexo`);
      continue;
    }
    if (!COMMIT) {
      console.log(`  + PL ${s.pl_number} (${pl.pl_number}) ← gss_id ${gssId}`);
      continue;
    }
    const { error: upError } = await db.from("pre_loadings").update({ gss_id: gssId }).eq("id", pl.id);
    console.log(upError ? `  ✗ PL ${s.pl_number}: ${upError.message}` : `  ✓ PL ${s.pl_number} ← gss_id ${gssId}`);
  }
}

async function main() {
  console.log(COMMIT ? `COMMIT (lotes via ${API})` : "DRY-RUN — nada é gravado");
  await seedBatches();
  await seedShipments();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
