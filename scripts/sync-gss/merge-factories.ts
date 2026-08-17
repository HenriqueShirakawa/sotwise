/**
 * Merge das fábricas duplicadas (INTEGRACAO_GSS §6.3 / §9.5).
 *
 * Duplicata local = 2+ linhas de `factories` com o mesmo nome normalizado. Nasce
 * de recadastro manual no Bubble; depois o pareamento com o GSS gravou `gss_id`
 * em UMA delas. Os pedidos ficaram espalhados entre as cópias.
 *
 * Regra (decidida com o Henrique em 17/08/2026):
 *   sobrevivente = a linha PAREADA AO GSS (tem `gss_id`) — identidade canônica da
 *   origem. Se o grupo não tem nenhuma com `gss_id`, sobrevive a MAIS USADA
 *   (mais `order_factory_category`), desempate por menor id. Grupo com 2+ `gss_id`
 *   distintos NÃO é mexido (exige decisão humana — §9.4).
 *
 * O merge repõe pro sobrevivente as 5 FKs que apontam pra `factories` e depois
 * soft-deleta as cópias:
 *   - order_factory_category.factory_id       (update simples)
 *   - etd_info.dispatch_location_id           (update simples)
 *   - step_attachments.factory_id             (update simples)
 *   - pre_loading_checklist_steps.consolidation_point_id (update simples)
 *   - category_factories (PK category_id,factory_id) → une: se o sobrevivente já
 *     tem a categoria, apaga a linha da cópia; senão repõe factory_id.
 *
 *   npx tsx scripts/sync-gss/merge-factories.ts             # DRY-RUN (só o plano)
 *   npx tsx scripts/sync-gss/merge-factories.ts --commit    # aplica (faz backup antes)
 *
 * Idempotente: cópia soft-deletada sai do agrupamento; rodar de novo dá 0 merges.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";
import { norm } from "../../lib/gss/sync";

const COMMIT = process.argv.includes("--commit");

const supabase = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

type Factory = { id: string; name: string; gss_id: string | null };

/** Puxa TODAS as linhas de uma coluna, paginando (evita o teto de 1000). */
async function fetchAllCol<T>(
  table: string,
  cols: string,
  tweak?: (q: any) => any
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    // nomes de tabela/coluna dinâmicos: handle destipado (só neste script de limpeza)
    let q = (supabase as any).from(table).select(cols).range(from, from + PAGE - 1);
    if (tweak) q = tweak(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function main() {
  console.log(`\n== Merge de factories duplicadas  [${COMMIT ? "COMMIT" : "DRY-RUN"}] ==\n`);

  const factories = await fetchAllCol<Factory>("factories", "id, name, gss_id", (q) =>
    q.is("deleted_at", null)
  );

  // ofc por fábrica (para escolher a sobrevivente sem gss_id e para o relatório)
  const ofcRows = await fetchAllCol<{ factory_id: string }>(
    "order_factory_category",
    "factory_id"
  );
  const ofcCount = new Map<string, number>();
  for (const r of ofcRows) ofcCount.set(r.factory_id, (ofcCount.get(r.factory_id) ?? 0) + 1);

  // agrupa por nome normalizado
  const grupos = new Map<string, Factory[]>();
  for (const f of factories) {
    const k = norm(f.name);
    (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(f);
  }

  type Plano = { k: string; survivor: Factory; losers: Factory[] };
  const planos: Plano[] = [];
  const pulados: string[] = [];

  for (const [k, rows] of grupos) {
    if (rows.length < 2) continue;
    const comGss = rows.filter((r) => r.gss_id);
    const gssDistintos = new Set(comGss.map((r) => r.gss_id));
    if (gssDistintos.size >= 2) {
      pulados.push(`${rows[0].name} (${gssDistintos.size} gss_id distintos — §9.4, decisão humana)`);
      continue;
    }
    const survivor =
      comGss[0] ??
      [...rows].sort(
        (a, b) => (ofcCount.get(b.id) ?? 0) - (ofcCount.get(a.id) ?? 0) || a.id.localeCompare(b.id)
      )[0];
    const losers = rows.filter((r) => r.id !== survivor.id);
    planos.push({ k, survivor, losers });
  }

  // relatório do plano
  let totLosers = 0;
  let totOfcMove = 0;
  for (const p of planos) {
    const via = p.survivor.gss_id ? `gss_id ${p.survivor.gss_id}` : "mais usada (sem gss)";
    const movidos = p.losers.reduce((s, l) => s + (ofcCount.get(l.id) ?? 0), 0);
    totLosers += p.losers.length;
    totOfcMove += movidos;
    console.log(
      `${p.survivor.name.padEnd(22)} sobrevive [${via}], ofc ${ofcCount.get(p.survivor.id) ?? 0}` +
        `  ← ${p.losers.length} cópia(s) (ofc a mover: ${movidos})`
    );
  }
  console.log(
    `\nTOTAL: ${planos.length} grupos, ${totLosers} cópias a soft-deletar, ${totOfcMove} vínculos ofc a repontar.`
  );
  if (pulados.length) {
    console.log(`\nPULADOS (decisão humana):`);
    for (const s of pulados) console.log(`   - ${s}`);
  }

  if (!COMMIT) {
    console.log(`\nDry-run: nada foi escrito. Rode com --commit para aplicar.`);
    return;
  }

  // ---- BACKUP antes de mexer ----
  const loserIds = planos.flatMap((p) => p.losers.map((l) => l.id));
  const inList = (col: string) => (q: any) => q.in(col, loserIds);
  const backup = {
    quando: new Date().toISOString(),
    planos: planos.map((p) => ({ k: p.k, survivor: p.survivor.id, losers: p.losers.map((l) => l.id) })),
    factories: factories.filter((f) => loserIds.includes(f.id)),
    order_factory_category: await fetchAllCol("order_factory_category", "id, factory_id", inList("factory_id")),
    etd_info: await fetchAllCol("etd_info", "id, dispatch_location_id", inList("dispatch_location_id")),
    step_attachments: await fetchAllCol("step_attachments", "id, factory_id", inList("factory_id")),
    pre_loading_checklist_steps: await fetchAllCol("pre_loading_checklist_steps", "id, consolidation_point_id", inList("consolidation_point_id")),
    category_factories: await fetchAllCol("category_factories", "category_id, factory_id", inList("factory_id")),
  };
  const path = join(tmpdir(), `merge-factories-backup-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(backup, null, 2));
  console.log(`\nBackup das linhas afetadas: ${path}`);

  // ---- aplica grupo a grupo (repõe FK, depois soft-delete) ----
  const upd = async (table: string, col: string, loserId: string, survivorId: string) => {
    const { error } = await (supabase as any)
      .from(table)
      .update({ [col]: survivorId })
      .eq(col, loserId);
    if (error) throw new Error(`${table}.${col} ${loserId}→${survivorId}: ${error.message}`);
  };

  let feitos = 0;
  for (const p of planos) {
    const S = p.survivor.id;
    // categorias que o sobrevivente já tem (para unir category_factories sem colidir na PK)
    const { data: sCats, error: e1 } = await supabase
      .from("category_factories")
      .select("category_id")
      .eq("factory_id", S);
    if (e1) throw new Error(`ler cats do sobrevivente: ${e1.message}`);
    const survCats = new Set((sCats ?? []).map((c) => c.category_id));

    for (const l of p.losers) {
      // category_factories: une (apaga o que colide, repõe o resto)
      const { data: lCats, error: e2 } = await supabase
        .from("category_factories")
        .select("category_id")
        .eq("factory_id", l.id);
      if (e2) throw new Error(`ler cats da cópia: ${e2.message}`);
      for (const c of lCats ?? []) {
        if (survCats.has(c.category_id)) {
          const { error } = await supabase
            .from("category_factories")
            .delete()
            .eq("factory_id", l.id)
            .eq("category_id", c.category_id);
          if (error) throw new Error(`del cf ${l.id}/${c.category_id}: ${error.message}`);
        } else {
          const { error } = await supabase
            .from("category_factories")
            .update({ factory_id: S })
            .eq("factory_id", l.id)
            .eq("category_id", c.category_id);
          if (error) throw new Error(`upd cf ${l.id}/${c.category_id}: ${error.message}`);
          survCats.add(c.category_id);
        }
      }
      // demais FKs: update simples
      await upd("order_factory_category", "factory_id", l.id, S);
      await upd("etd_info", "dispatch_location_id", l.id, S);
      await upd("step_attachments", "factory_id", l.id, S);
      await upd("pre_loading_checklist_steps", "consolidation_point_id", l.id, S);
      // soft-delete da cópia
      const { error } = await supabase
        .from("factories")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", l.id);
      if (error) throw new Error(`soft-delete ${l.id}: ${error.message}`);
      feitos++;
    }
  }
  console.log(`\nGRAVADO: ${feitos} cópias fundidas no sobrevivente e soft-deletadas.`);
}

main().catch((e) => {
  console.error("FALHOU:", e);
  process.exit(1);
});
