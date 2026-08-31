/**
 * Aplica as decisões do Rapha sobre a aba "Suppliers → factories" do documento
 * comparativo GSS × SOTWISE (GSS_vs_SOTWISE_REVISADA.xlsx, revisão de 31/08/2026).
 *
 * O documento tem 42 linhas com decisão; 8 são "@Gustavo ajustar GSS" (lado de
 * lá, não se toca aqui). As 34 nossas — todas do grupo "Só no nosso banco (sem
 * gss_id)", isto é, linhas que a migração do Bubble criou com o nome digitado
 * errado — caem em três tratamentos:
 *
 *   APELIDOS  o mesmo fabricante escrito de outro jeito ("Fenguang" ≠ "Fengguang").
 *             As referências migram para a linha pareada ao GSS e a cópia vira
 *             soft-delete. Mesma mecânica do merge-libraries.ts, só que dirigida
 *             por PARES EXPLÍCITOS: aqui os nomes não são iguais nem por
 *             normalização, então o dedup automático nunca acharia esses grupos.
 *   RETIRAR   erro de cadastro sem correspondente ("Pode deletar"). Vira
 *             soft-delete, NÃO delete físico: `order_factory_category.factory_id`
 *             é ON DELETE CASCADE (init_schema §201), então apagar a fábrica
 *             apagaria junto entradas Factory × Category de pedidos reais. O
 *             soft-delete tira do cadastro e das seleções; o histórico do pedido
 *             continua de pé.
 *   PONTOS    "não é fábrica, é ponto de consolidação". Hoje fábrica e ponto de
 *             consolidação moram na MESMA tabela (`pre_loading_checklist_steps.
 *             consolidation_point_id` aponta para `factories`), então não há o
 *             que corrigir no dado — é decisão de modelo. Só relata.
 *
 *   npx tsx scripts/sync-gss/aplicar-revisao-fabricas.ts            # DRY-RUN
 *   npx tsx scripts/sync-gss/aplicar-revisao-fabricas.ts --commit   # aplica (backup antes)
 *
 * Idempotente: o que já foi aplicado aparece como "já aplicado" e é pulado.
 * Rodar DE NOVO depois de cada re-migração total do Bubble — ela recria os nomes
 * errados (ver §9.5 / wipe & reload).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";

/** Cópia (nome errado) → sobrevivente (linha pareada ao GSS). */
const APELIDOS: [copia: string, sobrevivente: string][] = [
  ["Bobang(Bonai)", "Bobang"],
  ["Chuangxiang", "Chuanxiang"],
  ["Donfang", "Dongfang"],
  // Único par em que o sobrevivente também não tem gss_id: os dois são o mesmo
  // ponto de consolidação, um deles com o "B" comido na digitação.
  ["est services intl Freight", "Best services intl Freight Ltd"],
  ["Fenguang", "Fengguang"],
  ["Fenying", "Fengying"],
  ["Hai wang", "Haiwang"],
  ["Hongteng", "Hongfeng"],
  ["Huazhou", "Hua Zhou Ke Ji"],
  ["Jinchum", "Jinchun"],
  ["Longxun", "Longxin"],
  ["Paizhe", "Paize"],
  ["Ribaed", "Ribard"],
  ["Shangma", "Shuangma"],
  ["Xiwang", "Xinwang"],
  ["Zhejiang Kreation", "Kreation"],
  ["Zhuguan", "Zhiguan"],
];

/** "Pode deletar" / "Erro mesmo, pode retirar" → soft-delete. */
const RETIRAR = [
  "Fengfu",
  "Fuke",
  "Joinhands",
  "Mactron",
  "Maibaot",
  "Mr Qiu",
  "Nazaxx",
  "Owen",
  "Shengrong",
  "Songde",
  "TECHUANG",
  "Xinhang",
];

/** "Não é uma fabrica, é um ponto de consolidação" → só relato. */
const PONTOS_DE_CONSOLIDACAO = [
  "Best services intl Freight Ltd",
  "Hangzhou Laiying Co., Ltd",
  "Shouzen",
  "Unknow",
  "Zenchum Office",
];

// Grafo de FK de `factories`. Igual ao do merge-libraries.ts, mais
// `factory_products` (criada depois, em 20260825120000).
type Simple = { table: string; col: string };
type Junction = { table: string; self: string; others: string[] };

const SIMPLE: Simple[] = [
  { table: "order_factory_category", col: "factory_id" },
  { table: "etd_info", col: "dispatch_location_id" },
  { table: "step_attachments", col: "factory_id" },
  { table: "pre_loading_checklist_steps", col: "consolidation_point_id" },
  { table: "factory_products", col: "factory_id" },
];
const JUNCTIONS: Junction[] = [
  { table: "category_factories", self: "factory_id", others: ["category_id"] },
];

const COMMIT = process.argv.includes("--commit");

const db = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
) as any;

type Row = { id: string; name: string; gss_id: string | null; deleted_at: string | null };

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

async function refCount(id: string): Promise<number> {
  let n = 0;
  for (const { table, col } of [...SIMPLE, ...JUNCTIONS.map((j) => ({ table: j.table, col: j.self }))]) {
    const { count, error } = await db.from(table).select("*", { count: "exact", head: true }).eq(col, id);
    if (error) throw new Error(`${table}.${col}: ${error.message}`);
    n += count ?? 0;
  }
  return n;
}

/** Move tudo o que aponta para `loser` e soft-deleta a cópia. */
async function fundir(loser: Row, survivor: Row): Promise<void> {
  // Junções (PK composta): união — se o sobrevivente já tem a tupla, apaga a da
  // cópia; senão repõe o lado `self`. Evita colisão de PK.
  for (const j of JUNCTIONS) {
    const atuais = await fetchAllCol<Record<string, string>>(j.table, j.others.join(", "), (q) =>
      q.eq(j.self, survivor.id)
    );
    const tem = new Set(atuais.map((r) => j.others.map((o) => r[o]).join("|")));
    const daCopia = await fetchAllCol<Record<string, string>>(j.table, j.others.join(", "), (q) =>
      q.eq(j.self, loser.id)
    );
    for (const r of daCopia) {
      const chave = j.others.map((o) => r[o]).join("|");
      let q = tem.has(chave)
        ? db.from(j.table).delete().eq(j.self, loser.id)
        : db.from(j.table).update({ [j.self]: survivor.id }).eq(j.self, loser.id);
      for (const o of j.others) q = q.eq(o, r[o]);
      const { error } = await q;
      if (error) throw new Error(`${j.table} ${loser.name}: ${error.message}`);
      tem.add(chave);
    }
  }

  for (const s of SIMPLE) {
    const { error } = await db.from(s.table).update({ [s.col]: survivor.id }).eq(s.col, loser.id);
    if (error) throw new Error(`${s.table}.${s.col} ${loser.name}: ${error.message}`);
  }

  const { error } = await db
    .from("factories")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", loser.id);
  if (error) throw new Error(`soft-delete ${loser.name}: ${error.message}`);
}

async function main() {
  console.log(`\n== Revisão das fábricas (doc de 31/08/2026)  [${COMMIT ? "COMMIT" : "DRY-RUN"}] ==`);

  const todas = await fetchAllCol<Row>("factories", "id, name, gss_id, deleted_at");
  const porNome = new Map<string, Row[]>();
  for (const f of todas) {
    const k = String(f.name ?? "").toLowerCase().trim();
    porNome.set(k, [...(porNome.get(k) ?? []), f]);
  }
  /** Exige exatamente uma linha ATIVA com aquele nome — senão é decisão humana. */
  const acharAtiva = (nome: string): Row | { erro: string } => {
    const todos = porNome.get(nome.toLowerCase().trim()) ?? [];
    const ativos = todos.filter((f) => !f.deleted_at);
    if (ativos.length === 1) return ativos[0];
    if (!todos.length) return { erro: "não existe" };
    if (!ativos.length) return { erro: "já soft-deletada" };
    return { erro: `${ativos.length} linhas ativas com esse nome` };
  };

  // ---------- apelidos ----------
  console.log(`\n── Apelidos (${APELIDOS.length}) ──`);
  const paraFundir: { loser: Row; survivor: Row; refs: number }[] = [];
  for (const [copia, sobrevivente] of APELIDOS) {
    const l = acharAtiva(copia);
    const s = acharAtiva(sobrevivente);
    if ("erro" in l) {
      console.log(`  PULADO  ${copia} → ${sobrevivente}: cópia ${l.erro}`);
      continue;
    }
    if ("erro" in s) {
      console.log(`  PULADO  ${copia} → ${sobrevivente}: destino ${s.erro}`);
      continue;
    }
    const refs = await refCount(l.id);
    paraFundir.push({ loser: l, survivor: s, refs });
    const via = s.gss_id ? `gss_id ${s.gss_id}` : "sem gss_id (os dois)";
    console.log(`  ${copia.padEnd(30)} → ${sobrevivente.padEnd(30)} [${via}]  refs a mover: ${refs}`);
  }

  // ---------- retirar ----------
  console.log(`\n── Retirar do cadastro (${RETIRAR.length}) ──`);
  const paraRetirar: { row: Row; refs: number }[] = [];
  for (const nome of RETIRAR) {
    const f = acharAtiva(nome);
    if ("erro" in f) {
      console.log(`  PULADO  ${nome}: ${f.erro}`);
      continue;
    }
    const refs = await refCount(f.id);
    paraRetirar.push({ row: f, refs });
    console.log(`  ${nome.padEnd(14)} soft-delete  (fica referenciada em ${refs} registro(s) — histórico preservado)`);
  }

  // ---------- pontos de consolidação ----------
  console.log(`\n── Pontos de consolidação (${PONTOS_DE_CONSOLIDACAO.length}) — nada a fazer ──`);
  for (const nome of PONTOS_DE_CONSOLIDACAO) {
    const f = acharAtiva(nome);
    if ("erro" in f) {
      console.log(`  ${nome}: ${f.erro}`);
      continue;
    }
    const { count } = await db
      .from("pre_loading_checklist_steps")
      .select("*", { count: "exact", head: true })
      .eq("consolidation_point_id", f.id);
    console.log(`  ${nome.padEnd(32)} usada como ponto de consolidação em ${count ?? 0} pré-embarque(s)`);
  }
  console.log(
    "  (fábrica e ponto de consolidação dividem a tabela `factories`; separar os dois é\n" +
      "   mudança de modelo, não correção de dado — fica para decisão do produto.)"
  );

  console.log(
    `\nRESUMO: ${paraFundir.length} apelidos a fundir (${paraFundir.reduce((s, p) => s + p.refs, 0)} referências), ` +
      `${paraRetirar.length} a retirar.`
  );

  if (!COMMIT) {
    console.log("\nDry-run: nada escrito. Rode com --commit para aplicar.");
    return;
  }
  if (!paraFundir.length && !paraRetirar.length) {
    console.log("\nNada a fazer.");
    return;
  }

  // ---------- backup ----------
  const afetadas = [...paraFundir.map((p) => p.loser.id), ...paraRetirar.map((p) => p.row.id)];
  const backup: Record<string, unknown> = {
    quando: new Date().toISOString(),
    doc: "GSS_vs_SOTWISE_REVISADA.xlsx (31/08/2026)",
    fundir: paraFundir.map((p) => ({ copia: p.loser, sobrevivente: p.survivor.id, refs: p.refs })),
    retirar: paraRetirar.map((p) => p.row),
  };
  for (const s of SIMPLE) {
    backup[`${s.table}.${s.col}`] = await fetchAllCol(s.table, `id, ${s.col}`, (q) => q.in(s.col, afetadas));
  }
  for (const j of JUNCTIONS) {
    backup[j.table] = await fetchAllCol(j.table, [j.self, ...j.others].join(", "), (q) => q.in(j.self, afetadas));
  }
  const path = join(tmpdir(), `revisao-fabricas-backup-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(backup, null, 2));
  console.log(`\nbackup: ${path}`);

  for (const { loser, survivor } of paraFundir) {
    await fundir(loser, survivor);
    console.log(`  fundido: ${loser.name} → ${survivor.name}`);
  }
  for (const { row } of paraRetirar) {
    const { error } = await db
      .from("factories")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) throw new Error(`soft-delete ${row.name}: ${error.message}`);
    console.log(`  retirada: ${row.name}`);
  }
  console.log(`\nGRAVADO: ${paraFundir.length} fusões, ${paraRetirar.length} retiradas.`);
}

main().catch((e) => {
  console.error("FALHOU:", e);
  process.exit(1);
});
