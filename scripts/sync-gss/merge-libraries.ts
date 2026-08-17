/**
 * Merge das bibliotecas duplicadas do GSS (INTEGRACAO_GSS §6.3 / §9.5).
 *
 * Generaliza o antigo merge-factories: dedup por nome normalizado em qualquer
 * biblioteca, dirigido pela config CONFIGS abaixo (o grafo de FK de cada tabela).
 *
 * Regra do sobrevivente (decidida com o Henrique, 17/08/2026):
 *   1) se o grupo tem UMA linha pareada ao GSS (`gss_id`), ela sobrevive — é a
 *      identidade canônica da origem;
 *   2) senão, sobrevive a MAIS USADA (mais referências nas FKs), desempate por id;
 *   3) grupo com 2+ `gss_id` distintos NÃO é mexido (decisão humana — §9.4).
 * Os pedidos/vínculos das cópias migram pro sobrevivente; as cópias viram
 * soft-delete. NÃO se cria registro novo (nasceria sem `gss_id`, órfão da origem).
 *
 * Dois tipos de FK:
 *   - `simple`: coluna que aponta pra cá sem PK composta → UPDATE col = survivor.
 *   - `junction`: junção de PK composta (o self entra na PK) → UNIÃO: se o
 *     sobrevivente já tem a mesma tupla `others`, apaga a linha da cópia; senão
 *     repõe o self. Evita colisão na PK.
 *
 *   npx tsx scripts/sync-gss/merge-libraries.ts                       # DRY-RUN, todas
 *   npx tsx scripts/sync-gss/merge-libraries.ts categories agents     # subconjunto
 *   npx tsx scripts/sync-gss/merge-libraries.ts --commit              # aplica (backup antes)
 *
 * Idempotente. Rodar DE NOVO após cada re-migração total do Bubble (recria dupes).
 * De máquina allowlistada (mesma restrição de Cloudflare do sync).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";
import { norm } from "../../lib/gss/sync";

type Simple = { table: string; col: string };
type Junction = { table: string; self: string; others: string[] };
type LibCfg = { table: string; simple: Simple[]; junctions: Junction[] };

// Grafo de FK confirmado em pg_constraint (17/08/2026). `self` = coluna da junção
// que aponta pra ESTA tabela; `others` = o resto da PK composta.
const CONFIGS: LibCfg[] = [
  {
    table: "factories",
    simple: [
      { table: "order_factory_category", col: "factory_id" },
      { table: "etd_info", col: "dispatch_location_id" },
      { table: "step_attachments", col: "factory_id" },
      { table: "pre_loading_checklist_steps", col: "consolidation_point_id" },
    ],
    junctions: [{ table: "category_factories", self: "factory_id", others: ["category_id"] }],
  },
  {
    table: "categories",
    simple: [{ table: "order_factory_category", col: "category_id" }],
    junctions: [{ table: "category_factories", self: "category_id", others: ["factory_id"] }],
  },
  {
    table: "contacts",
    simple: [
      { table: "pre_loading_checklist_steps", col: "contact_brazil_id" },
      { table: "pre_loading_checklist_steps", col: "contact_china_id" },
    ],
    junctions: [{ table: "agent_contacts", self: "contact_id", others: ["agent_id"] }],
  },
  {
    table: "agents",
    simple: [
      { table: "pre_loading_checklist_steps", col: "agent_brazil_id" },
      { table: "pre_loading_checklist_steps", col: "agent_china_id" },
      { table: "pre_loading_checklist_steps", col: "carrier_agent_id" },
    ],
    junctions: [
      { table: "agent_contacts", self: "agent_id", others: ["contact_id"] },
      { table: "carrier_agents", self: "agent_id", others: ["carrier_id"] },
    ],
  },
];

const argv = process.argv.slice(2);
const COMMIT = argv.includes("--commit");
const pedidos = argv.filter((a) => !a.startsWith("--"));

const db = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
) as any;

type Row = { id: string; name: string; gss_id: string | null };

/** Puxa TODAS as linhas de uma seleção, paginando (evita o teto de 1000). */
async function fetchAllCol<T>(table: string, cols: string, tweak?: (q: any) => any): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from(table).select(cols).range(from, from + PAGE - 1);
    if (tweak) q = tweak(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Conta, por id da biblioteca, quantas vezes é referenciada em todas as FKs. */
async function refCounts(cfg: LibCfg): Promise<Map<string, number>> {
  const count = new Map<string, number>();
  const cols: Simple[] = [
    ...cfg.simple,
    ...cfg.junctions.map((j) => ({ table: j.table, col: j.self })),
  ];
  for (const { table, col } of cols) {
    const rows = await fetchAllCol<Record<string, string | null>>(table, col);
    for (const r of rows) {
      const v = r[col];
      if (v) count.set(v, (count.get(v) ?? 0) + 1);
    }
  }
  return count;
}

type Plano = { k: string; survivor: Row; losers: Row[] };

// Nomes que NÃO identificam entidade — "mesmo placeholder" ≠ "mesmo registro".
// Ex.: 6 contatos "N/A" com telefones/e-mails diferentes são pessoas distintas.
// Grupos assim não são fundidos automaticamente: viram relato pra decisão humana.
const PLACEHOLDER = new Set(["", "n/a", "na", "n.a.", "n.a", "none", "null", "tbd", "-", "--", "?", "."]);

function planTable(rows: Row[], refs: Map<string, number>): { planos: Plano[]; pulados: string[] } {
  const grupos = new Map<string, Row[]>();
  for (const r of rows) (grupos.get(norm(r.name)) ?? grupos.set(norm(r.name), []).get(norm(r.name))!).push(r);

  const planos: Plano[] = [];
  const pulados: string[] = [];
  for (const [k, g] of grupos) {
    if (g.length < 2) continue;
    if (PLACEHOLDER.has(k)) {
      pulados.push(`"${g[0].name ?? "(em branco)"}" — ${g.length} linhas, nome placeholder: revisar à mão`);
      continue;
    }
    const comGss = g.filter((r) => r.gss_id);
    if (new Set(comGss.map((r) => r.gss_id)).size >= 2) {
      pulados.push(`${g[0].name} (${new Set(comGss.map((r) => r.gss_id)).size} gss_id distintos — §9.4)`);
      continue;
    }
    const survivor =
      comGss[0] ??
      [...g].sort((a, b) => (refs.get(b.id) ?? 0) - (refs.get(a.id) ?? 0) || a.id.localeCompare(b.id))[0];
    planos.push({ k, survivor, losers: g.filter((r) => r.id !== survivor.id) });
  }
  return { planos, pulados };
}

async function mergeTable(cfg: LibCfg): Promise<void> {
  const rows = await fetchAllCol<Row>(cfg.table, "id, name, gss_id", (q) => q.is("deleted_at", null));
  const refs = await refCounts(cfg);
  const { planos, pulados } = planTable(rows, refs);

  console.log(`\n── ${cfg.table} ──`);
  if (!planos.length && !pulados.length) {
    console.log("  sem duplicatas.");
    return;
  }
  for (const p of planos) {
    const via = p.survivor.gss_id ? `gss_id ${p.survivor.gss_id}` : `mais usada (refs ${refs.get(p.survivor.id) ?? 0})`;
    const mov = p.losers.reduce((s, l) => s + (refs.get(l.id) ?? 0), 0);
    console.log(`  ${p.survivor.name.padEnd(24)} sobrevive [${via}]  ← ${p.losers.length} cópia(s) (refs a mover: ${mov})`);
  }
  console.log(`  TOTAL: ${planos.length} grupos, ${planos.reduce((s, p) => s + p.losers.length, 0)} cópias.`);
  for (const s of pulados) console.log(`  PULADO (decisão humana): ${s}`);

  if (!COMMIT) return;

  // backup das linhas afetadas desta tabela
  const loserIds = planos.flatMap((p) => p.losers.map((l) => l.id));
  if (!loserIds.length) return;
  const inList = (col: string) => (q: any) => q.in(col, loserIds);
  const backup: Record<string, unknown> = {
    tabela: cfg.table,
    quando: new Date().toISOString(),
    planos: planos.map((p) => ({ survivor: p.survivor.id, losers: p.losers.map((l) => l.id) })),
    [cfg.table]: rows.filter((r) => loserIds.includes(r.id)),
  };
  for (const s of cfg.simple) backup[`${s.table}.${s.col}`] = await fetchAllCol(s.table, `id, ${s.col}`, inList(s.col));
  for (const j of cfg.junctions) backup[j.table] = await fetchAllCol(j.table, [j.self, ...j.others].join(", "), inList(j.self));
  const path = join(tmpdir(), `merge-${cfg.table}-backup-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(backup, null, 2));
  console.log(`  backup: ${path}`);

  let feitos = 0;
  for (const p of planos) {
    const S = p.survivor.id;
    // pré-carrega as tuplas `others` que o sobrevivente já tem em cada junção
    const survSets = new Map<string, Set<string>>();
    for (const j of cfg.junctions) {
      const cur = await fetchAllCol<Record<string, string>>(j.table, j.others.join(", "), (q) => q.eq(j.self, S));
      survSets.set(j.table, new Set(cur.map((r) => j.others.map((o) => r[o]).join("|"))));
    }

    for (const l of p.losers) {
      // junções: une (apaga colisão, repõe o resto)
      for (const j of cfg.junctions) {
        const set = survSets.get(j.table)!;
        const lr = await fetchAllCol<Record<string, string>>(j.table, j.others.join(", "), (q) => q.eq(j.self, l.id));
        for (const r of lr) {
          const key = j.others.map((o) => r[o]).join("|");
          let del = db.from(j.table).delete().eq(j.self, l.id);
          for (const o of j.others) del = del.eq(o, r[o]);
          if (set.has(key)) {
            const { error } = await del;
            if (error) throw new Error(`del ${j.table} ${l.id}: ${error.message}`);
          } else {
            let up = db.from(j.table).update({ [j.self]: S }).eq(j.self, l.id);
            for (const o of j.others) up = up.eq(o, r[o]);
            const { error } = await up;
            if (error) throw new Error(`upd ${j.table} ${l.id}: ${error.message}`);
            set.add(key);
          }
        }
      }
      // FKs simples: update direto
      for (const s of cfg.simple) {
        const { error } = await db.from(s.table).update({ [s.col]: S }).eq(s.col, l.id);
        if (error) throw new Error(`${s.table}.${s.col} ${l.id}: ${error.message}`);
      }
      // soft-delete da cópia
      const { error } = await db.from(cfg.table).update({ deleted_at: new Date().toISOString() }).eq("id", l.id);
      if (error) throw new Error(`soft-delete ${cfg.table} ${l.id}: ${error.message}`);
      feitos++;
    }
  }
  console.log(`  GRAVADO: ${feitos} cópias fundidas e soft-deletadas.`);
}

async function main() {
  const alvo = pedidos.length ? CONFIGS.filter((c) => pedidos.includes(c.table)) : CONFIGS;
  if (!alvo.length) {
    console.error(`Nenhuma tabela casou. Válidas: ${CONFIGS.map((c) => c.table).join(", ")}`);
    process.exit(1);
  }
  console.log(`\n== Merge de bibliotecas  [${COMMIT ? "COMMIT" : "DRY-RUN"}]  (${alvo.map((c) => c.table).join(", ")}) ==`);
  for (const cfg of alvo) await mergeTable(cfg);
  if (!COMMIT) console.log(`\nDry-run: nada escrito. Rode com --commit para aplicar.`);
}

main().catch((e) => {
  console.error("FALHOU:", e);
  process.exit(1);
});
