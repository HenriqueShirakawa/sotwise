/**
 * Documento comparativo GSS × SOTWISE (bibliotecas), no formato do xlsx que o
 * Henrique acompanha. Só leitura — não escreve no banco.
 *
 *   npx tsx scripts/sync-gss/gss-vs-sotwise.ts [saida.xlsx] [baseline.xlsx]
 *
 * Lado GSS: tabela `gss_snapshot` (rode `snapshot.ts` antes).
 * Lado nosso: as tabelas de biblioteca (com `gss_id` já pareado por `sync.ts`).
 * Abas: Resumo + uma por recurso (RECURSOS) + "Fabricas x Orders" + "Mudanças".
 *
 * Classificação por linha:
 *   Pareado                         nossa linha tem gss_id que casa com o GSS
 *   Só no GSS                       gss_id sem par local
 *   Só no nosso banco (sem gss_id)  nossa linha sem gss_id
 *
 * A coluna "Mudou desde doc anterior" e a aba "Mudanças" comparam com o xlsx
 * baseline (o documento anterior), quando informado.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { RECURSOS, type Recurso } from "../../lib/gss/recursos";

const OUT = process.argv[2] ?? "GSS_vs_SOTWISE_bibliotecas.xlsx";
const BASELINE = process.argv[3] ?? "";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
}) as any;

type Snap = { resource: string; gss_id: number; payload: Record<string, any> };
type Local = { id: string; name: string | null; gss_id: string | null };

const norm = (s: any) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");

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

// ---------- baseline (documento anterior) ----------
type BaselineSheet = { gssIds: Set<string>; pairedGssIds: Set<string> };
function loadBaseline(path: string): Map<string, BaselineSheet> {
  const map = new Map<string, BaselineSheet>();
  if (!path) return map;
  const wb = XLSX.readFile(path);
  for (const name of wb.SheetNames) {
    const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
    if (!rows.length) continue;
    const header = rows[0].map((h) => String(h).toLowerCase());
    const iGss = header.findIndex((h) => h.includes("gss_id"));
    const iStatus = header.findIndex((h) => h.includes("status"));
    if (iGss < 0) continue;
    const bs: BaselineSheet = { gssIds: new Set(), pairedGssIds: new Set() };
    for (let r = 1; r < rows.length; r++) {
      const gss = String(rows[r][iGss] ?? "").trim();
      if (!gss) continue;
      bs.gssIds.add(gss);
      const st = iStatus >= 0 ? String(rows[r][iStatus] ?? "") : "";
      if (/pareado/i.test(st)) bs.pairedGssIds.add(gss);
    }
    map.set(name, bs);
  }
  return map;
}

function mudou(gssId: string | null, paired: boolean, base?: BaselineSheet): string {
  if (!base || !gssId) return "";
  if (!base.gssIds.has(gssId)) return "NOVO";
  if (paired && !base.pairedGssIds.has(gssId)) return "PAREOU";
  return "";
}

async function main() {
  // snapshot do GSS
  const snap = await fetchAll<Snap>("gss_snapshot", "resource, gss_id, payload");
  const byResource = new Map<string, Snap[]>();
  for (const s of snap) (byResource.get(s.resource) ?? byResource.set(s.resource, []).get(s.resource)!).push(s);

  const baseline = loadBaseline(BASELINE);
  const wb = XLSX.utils.book_new();
  const resumo: any[] = [];
  const mudancas: any[] = [];

  // ---------- uma aba por recurso ----------
  for (const rec of RECURSOS as readonly Recurso[]) {
    const gssRows = (byResource.get(rec.key) ?? []).map((s) => ({
      gss_id: String(s.gss_id),
      name: s.payload[rec.campoNome] ?? "",
      detalhe: rec.campoDetalhe ? (s.payload[rec.campoDetalhe] ?? "") : "",
    }));
    const localRows = await fetchAll<Local>(rec.table, "id, name, gss_id", (q) => q.is("deleted_at", null));

    const localByGss = new Map<string, Local>();
    for (const l of localRows) if (l.gss_id) localByGss.set(l.gss_id, l);
    const base = baseline.get(rec.label);

    const out: any[] = [];
    let pareados = 0, soGss = 0, soNosso = 0;

    // GSS rows: Pareado ou Só no GSS
    for (const g of gssRows.sort((a, b) => norm(a.name).localeCompare(norm(b.name)))) {
      const local = localByGss.get(g.gss_id);
      const paired = !!local;
      if (paired) pareados++; else soGss++;
      const row: any = { gss_id: g.gss_id, "Nome no GSS": g.name };
      if (rec.detalheLabel) row[rec.detalheLabel] = g.detalhe;
      row["Nome no nosso banco"] = local?.name ?? "";
      row["Status"] = paired ? "Pareado" : "Só no GSS";
      const m = mudou(g.gss_id, paired, base);
      row["Mudou desde doc anterior"] = m;
      if (m) {
        mudancas.push({
          Biblioteca: rec.label,
          gss_id: g.gss_id,
          "Nome no GSS": g.name,
          "Nome no nosso banco": local?.name ?? "",
          Antes: m === "NOVO" ? "(não existia)" : "Só no GSS",
          Agora: paired ? "Pareado" : "Só no GSS",
          Mudança: m,
        });
      }
      out.push(row);
    }
    // nossas linhas sem gss_id: Só no nosso banco
    for (const l of localRows.filter((l) => !l.gss_id).sort((a, b) => norm(a.name).localeCompare(norm(b.name)))) {
      soNosso++;
      const row: any = { gss_id: "", "Nome no GSS": "" };
      if (rec.detalheLabel) row[rec.detalheLabel] = "";
      row["Nome no nosso banco"] = l.name ?? "";
      row["Status"] = "Só no nosso banco (sem gss_id)";
      row["Mudou desde doc anterior"] = "";
      out.push(row);
    }

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(out), rec.label.slice(0, 31));
    const totalGss = gssRows.length;
    resumo.push({
      Biblioteca: rec.label,
      "Tabela (nosso banco)": rec.table,
      "No GSS": totalGss,
      "No nosso banco": localRows.length,
      Pareados: pareados,
      "Só no GSS": soGss,
      "Só nosso (sem gss_id)": soNosso,
      "% pareado": totalGss ? Math.round((pareados / totalGss) * 100) + "%" : "—",
      "Pareados (doc anterior)": base ? base.pairedGssIds.size : "",
      "Δ pareados": base ? pareados - base.pairedGssIds.size : "",
      "No GSS (doc anterior)": base ? base.gssIds.size : "",
      "Δ no GSS": base ? totalGss - base.gssIds.size : "",
    });
  }

  // ---------- Fábricas × Orders (recomputa a aba Suppliers com contagem) ----------
  const facs = await fetchAll<Local>("factories", "id, name, gss_id", (q) => q.is("deleted_at", null));
  const facById = new Map(facs.map((f) => [f.id, f]));
  const orders = await fetchAll<{ id: string; po_number: string; date_po: string | null; created_at: string; status: string }>(
    "orders", "id, po_number, date_po, created_at, status", (q) => q.is("deleted_at", null)
  );
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const ofc = await fetchAll<{ factory_id: string; order_id: string }>("order_factory_category", "factory_id, order_id");

  // factory_id -> set de order_ids
  const ordersByFac = new Map<string, Set<string>>();
  for (const r of ofc) {
    if (!r.factory_id || !r.order_id) continue;
    (ordersByFac.get(r.factory_id) ?? ordersByFac.set(r.factory_id, new Set()).get(r.factory_id)!).add(r.order_id);
  }

  // aba "Fabricas x Orders": uma linha por (fábrica, order)
  const fxo: any[] = [];
  for (const [facId, orderIds] of ordersByFac) {
    const f = facById.get(facId);
    if (!f) continue;
    for (const oid of orderIds) {
      const o = orderById.get(oid);
      if (!o) continue;
      fxo.push({
        "Fábrica": f.name ?? "",
        gss_id: f.gss_id ?? "",
        Pareamento: f.gss_id ? "Pareado" : "Só no nosso banco (sem gss_id)",
        PO: o.po_number,
        "Data da PO": (o.date_po ?? o.created_at ?? "").slice(0, 10),
        "Status da order": o.status,
      });
    }
  }
  fxo.sort((a, b) => norm(a["Fábrica"]).localeCompare(norm(b["Fábrica"])) || String(a.PO).localeCompare(String(b.PO)));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(fxo), "Fabricas x Orders");

  // enriquecer a aba Suppliers → factories com Nº de orders / última / POs
  const supIdx = wb.SheetNames.indexOf("Suppliers → factories".slice(0, 31));
  if (supIdx >= 0) {
    const sheet = wb.Sheets[wb.SheetNames[supIdx]];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    const localByName = new Map<string, Local>();
    for (const f of facs) localByName.set(norm(f.name), f);
    for (const row of rows) {
      const f = localByName.get(norm(row["Nome no nosso banco"]));
      if (f && ordersByFac.has(f.id)) {
        const oids = [...ordersByFac.get(f.id)!].map((id) => orderById.get(id)).filter(Boolean) as any[];
        oids.sort((a, b) => String(b.date_po ?? b.created_at).localeCompare(String(a.date_po ?? a.created_at)));
        row["Nº de orders"] = oids.length;
        row["Última order"] = (oids[0]?.date_po ?? oids[0]?.created_at ?? "").slice(0, 10);
        row["Orders (PO)"] = oids.slice(0, 20).map((o) => o.po_number).join(", ");
      } else {
        row["Nº de orders"] = "";
        row["Última order"] = "";
        row["Orders (PO)"] = "";
      }
    }
    wb.Sheets[wb.SheetNames[supIdx]] = XLSX.utils.json_to_sheet(rows);
  }

  // ---------- Mudanças (agregado NOVO/PAREOU vs doc anterior) ----------
  if (BASELINE) {
    mudancas.sort((a, b) => String(a.Biblioteca).localeCompare(String(b.Biblioteca)) || norm(a["Nome no GSS"]).localeCompare(norm(b["Nome no GSS"])));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      mudancas.length ? mudancas : [{ Biblioteca: "(sem mudanças vs baseline)" }]
    ), "Mudanças");
  }

  // ---------- Resumo (primeira aba) ----------
  const wsResumo = XLSX.utils.json_to_sheet(resumo);
  XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");
  // move Resumo para o começo
  wb.SheetNames = ["Resumo", ...wb.SheetNames.filter((n) => n !== "Resumo")];

  XLSX.writeFile(wb, OUT);
  console.log(`\n✔ ${OUT}`);
  console.log("\nResumo:");
  console.table(resumo);
  console.log(`Fabricas x Orders: ${fxo.length} linhas`);
}

main().catch((e) => { console.error("FALHOU:", e); process.exit(1); });
