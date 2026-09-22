/**
 * Planilha GSS × SOTWISE — só Factories, Categories e a correlação entre elas
 * (Factory × Category). Lê o GSS AO VIVO (endpoints `supplier` e
 * `supplier-category`), não o snapshot em cache (`gss_snapshot`) — para pegar
 * dado recém-atualizado na origem. Só leitura — não escreve no banco nem no GSS.
 *
 *   npx tsx scripts/sync-gss/factories-categories-report.ts [saida.xlsx]
 *
 * Precisa rodar de máquina allowlistada no Cloudflare do GSS (ver lib/gss/client.ts).
 *
 * `supplier-category` é a tabela de PRODUTO da fábrica, não uma junção pura
 * (docs/INTEGRACAO_GSS.md §3.5.2.1): o mesmo par Fábrica×Categoria repete por
 * `code`. Aqui ele é deduplicado para virar a correlação Factory × Category,
 * igual a `runSync` faz para `categories`/`category_factories`
 * (ver lib/gss/sync.ts).
 *
 * Abas: Resumo, Factories, Categories, Correlations.
 * Status por linha: "Pareado" (gss_id local bate), "Só no GSS" (sem par aqui),
 * "Só no nosso banco" (nosso registro sem gss_id ou vínculo que sumiu do GSS).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { gssGet, GSS_ENDPOINTS, type GssSupplier, type GssSupplierCategory } from "../../lib/gss/client";
import { norm } from "../../lib/gss/sync";

const OUT = process.argv[2] ?? "GSS_vs_SOTWISE_Factories_Categories.xlsx";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
}) as any;

type Local = { id: string; name: string; gss_id: string | null };
type Junction = { category_id: string; factory_id: string };

async function fetchAll<T>(table: string, cols: string, tweak?: (q: any) => any): Promise<T[]> {
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

async function fetchGss<T>(endpoint: string): Promise<T[]> {
  const r = await gssGet<T[]>(endpoint);
  if (!r.ok) throw new Error(`GSS ${endpoint}: ${r.error}`);
  return r.data;
}

async function main() {
  console.log("Lendo GSS ao vivo (supplier, supplier-category)…");
  const suppliers = await fetchGss<GssSupplier>(GSS_ENDPOINTS.supplier);
  const supplierCategories = await fetchGss<GssSupplierCategory>(GSS_ENDPOINTS.supplierCategory);
  console.log(`  supplier: ${suppliers.length} | supplier-category: ${supplierCategories.length}`);

  console.log("Lendo nosso banco (factories, categories, category_factories)…");
  const facLocal = await fetchAll<Local>("factories", "id, name, gss_id", (q) => q.is("deleted_at", null));
  const catLocal = await fetchAll<Local>("categories", "id, name, gss_id", (q) => q.is("deleted_at", null));
  const junction = await fetchAll<Junction>("category_factories", "category_id, factory_id");

  const facByGss = new Map(facLocal.filter((f) => f.gss_id).map((f) => [f.gss_id as string, f]));
  const catByGss = new Map(catLocal.filter((c) => c.gss_id).map((c) => [c.gss_id as string, c]));
  const facById = new Map(facLocal.map((f) => [f.id, f]));
  const catByIdLocal = new Map(catLocal.map((c) => [c.id, c]));
  const junctionSet = new Set(junction.map((j) => `${j.category_id}|${j.factory_id}`));

  const wb = XLSX.utils.book_new();
  const resumo: Record<string, unknown>[] = [];

  // ---------- Factories ----------
  const facRows: Record<string, unknown>[] = [];
  let facPareado = 0, facSoGss = 0;
  for (const s of [...suppliers].sort((a, b) => norm(a.company_name).localeCompare(norm(b.company_name)))) {
    const local = facByGss.get(String(s.id));
    const paired = !!local;
    if (paired) facPareado++; else facSoGss++;
    facRows.push({
      gss_id: s.id,
      "Nome no GSS": s.company_name,
      "Obsoleta no GSS": s.is_obsolete ? "Sim" : "",
      "Nome no nosso banco": local?.name ?? "",
      Status: paired ? "Pareado" : "Só no GSS",
    });
  }
  let facSoNosso = 0;
  for (const f of facLocal.filter((f) => !f.gss_id).sort((a, b) => norm(a.name).localeCompare(norm(b.name)))) {
    facSoNosso++;
    facRows.push({
      gss_id: "", "Nome no GSS": "", "Obsoleta no GSS": "",
      "Nome no nosso banco": f.name, Status: "Só no nosso banco (sem gss_id)",
    });
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(facRows), "Factories");
  resumo.push({
    Biblioteca: "Factories", "No GSS": suppliers.length, "No nosso banco": facLocal.length,
    Pareados: facPareado, "Só no GSS": facSoGss, "Só nosso (sem gss_id)": facSoNosso,
  });

  // ---------- Categories (derivada de supplier-category, igual ao sync.ts) ----------
  const catById = new Map<number, string>();
  for (const row of supplierCategories) if (!catById.has(row.category)) catById.set(row.category, row.category_name);
  const catsGss = [...catById.entries()].map(([id, name]) => ({ id, name }));

  const catRows: Record<string, unknown>[] = [];
  let catPareado = 0, catSoGss = 0;
  for (const c of catsGss.sort((a, b) => norm(a.name).localeCompare(norm(b.name)))) {
    const local = catByGss.get(String(c.id));
    const paired = !!local;
    if (paired) catPareado++; else catSoGss++;
    catRows.push({
      gss_id: c.id, "Nome no GSS": c.name,
      "Nome no nosso banco": local?.name ?? "", Status: paired ? "Pareado" : "Só no GSS",
    });
  }
  let catSoNosso = 0;
  for (const c of catLocal.filter((c) => !c.gss_id).sort((a, b) => norm(a.name).localeCompare(norm(b.name)))) {
    catSoNosso++;
    catRows.push({ gss_id: "", "Nome no GSS": "", "Nome no nosso banco": c.name, Status: "Só no nosso banco (sem gss_id)" });
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(catRows), "Categories");
  resumo.push({
    Biblioteca: "Categories", "No GSS": catsGss.length, "No nosso banco": catLocal.length,
    Pareados: catPareado, "Só no GSS": catSoGss, "Só nosso (sem gss_id)": catSoNosso,
  });

  // ---------- Correlations (Factory × Category) ----------
  const pairAgg = new Map<string, { supplier: number; supplierName: string; category: number; categoryName: string; codes: Set<string> }>();
  for (const row of supplierCategories) {
    const key = `${row.category}|${row.supplier}`;
    let agg = pairAgg.get(key);
    if (!agg) {
      agg = { supplier: row.supplier, supplierName: row.supplier_name, category: row.category, categoryName: row.category_name, codes: new Set() };
      pairAgg.set(key, agg);
    }
    if (row.code) agg.codes.add(row.code);
  }

  const corrRows: Record<string, unknown>[] = [];
  let corrPareado = 0, corrFaltaVincular = 0, corrNaoPareada = 0;
  const gssPairKeysResolved = new Set<string>();

  for (const agg of [...pairAgg.values()].sort((a, b) =>
    norm(a.supplierName).localeCompare(norm(b.supplierName)) || norm(a.categoryName).localeCompare(norm(b.categoryName))
  )) {
    const fac = facByGss.get(String(agg.supplier));
    const cat = catByGss.get(String(agg.category));
    let status: string;
    if (fac && cat) {
      const key = `${cat.id}|${fac.id}`;
      gssPairKeysResolved.add(key);
      if (junctionSet.has(key)) { status = "Pareado"; corrPareado++; }
      else { status = "Falta sincronizar (fábrica e categoria pareadas, vínculo não)"; corrFaltaVincular++; }
    } else {
      status = "Fábrica ou categoria ainda não pareada aqui";
      corrNaoPareada++;
    }
    corrRows.push({
      "Fábrica (GSS)": agg.supplierName,
      "Categoria (GSS)": agg.categoryName,
      gss_supplier_id: agg.supplier,
      gss_category_id: agg.category,
      "Qtd. produtos (codes)": agg.codes.size,
      "Fábrica no nosso banco": fac?.name ?? "",
      "Categoria no nosso banco": cat?.name ?? "",
      Status: status,
    });
  }

  let corrSoNosso = 0;
  const localOnlyPairs = junction
    .map((j) => ({ fac: facById.get(j.factory_id), cat: catByIdLocal.get(j.category_id), key: `${j.category_id}|${j.factory_id}` }))
    .filter((p): p is { fac: Local; cat: Local; key: string } => !!p.fac && !!p.cat && !gssPairKeysResolved.has(p.key));
  for (const p of localOnlyPairs.sort((a, b) => norm(a.fac.name).localeCompare(norm(b.fac.name)) || norm(a.cat.name).localeCompare(norm(b.cat.name)))) {
    corrSoNosso++;
    const semGss = !p.fac.gss_id || !p.cat.gss_id;
    corrRows.push({
      "Fábrica (GSS)": "", "Categoria (GSS)": "", gss_supplier_id: "", gss_category_id: "", "Qtd. produtos (codes)": "",
      "Fábrica no nosso banco": p.fac.name,
      "Categoria no nosso banco": p.cat.name,
      Status: semGss ? "Só no nosso banco (fábrica/categoria sem gss_id)" : "Só no nosso banco (sumiu do GSS)",
    });
  }

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(corrRows), "Correlations");
  resumo.push({
    Biblioteca: "Correlations (Factory × Category)",
    "No GSS": pairAgg.size,
    "No nosso banco": junction.length,
    Pareados: corrPareado,
    "Só no GSS (falta vincular aqui)": corrFaltaVincular,
    "Só no GSS (fábrica/categoria não pareada)": corrNaoPareada,
    "Só nosso (sem correspondência no GSS)": corrSoNosso,
  });

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), "Resumo");
  wb.SheetNames = ["Resumo", ...wb.SheetNames.filter((n) => n !== "Resumo")];

  XLSX.writeFile(wb, OUT);
  console.log(`\n✔ ${OUT}`);
  console.table(resumo);
}

main().catch((e) => {
  console.error("FALHOU:", e);
  process.exit(1);
});
