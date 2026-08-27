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
 * Cada aba de biblioteca traz um JOIN de Orders (Nº de orders / Última order /
 * Orders (PO)) — a via até a order é diferente por biblioteca (ver ORDER_JOIN):
 *   direto em orders        clients, order_types, business_units, exporters
 *   via order_factory_categ factories, categories
 *   via pre-loading→batches pods, cities, pols, agents, carriers, contacts
 *   via clients.country_id  countries
 *
 * Classificação por linha:
 *   Pareado                         nossa linha tem gss_id que casa com o GSS
 *   Só no GSS                       gss_id sem par local
 *   Só no nosso banco (sem gss_id)  nossa linha sem gss_id
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { RECURSOS, type Recurso } from "../../lib/gss/recursos";

const OUT = process.argv[2] ?? "GSS_vs_SOTWISE_bibliotecas.xlsx";
const BASELINE = process.argv[3] ?? "";
const PO_LIMIT = 30; // máximo de POs listados por célula

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
}) as any;

type Snap = { resource: string; gss_id: number; payload: Record<string, any> };
type Local = { id: string; name: string | null; gss_id: string | null };
type Order = { id: string; po_number: string; date_po: string | null; created_at: string; status: string };

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

// ---------- JOIN de Orders por biblioteca ----------
type OrderMaps = {
  ordersById: Map<string, Order>;
  /** table -> (localId -> set de order ids) */
  byTable: Map<string, Map<string, Set<string>>>;
};

function addLink(m: Map<string, Set<string>>, key: string | null | undefined, orderId: string) {
  if (!key) return;
  (m.get(key) ?? m.set(key, new Set()).get(key)!).add(orderId);
}

async function buildOrderMaps(): Promise<OrderMaps> {
  const orders = await fetchAll<Order & { client_id: string | null; order_type_id: string | null; business_unit_id: string | null; exporter_id: string | null }>(
    "orders",
    "id, po_number, date_po, created_at, status, client_id, order_type_id, business_unit_id, exporter_id",
    (q) => q.is("deleted_at", null)
  );
  const ordersById = new Map<string, Order>(orders.map((o) => [o.id, o]));

  const byTable = new Map<string, Map<string, Set<string>>>();
  const tbl = (t: string) => byTable.get(t) ?? byTable.set(t, new Map()).get(t)!;

  // diretos em orders
  for (const o of orders) {
    addLink(tbl("clients"), o.client_id, o.id);
    addLink(tbl("order_types"), o.order_type_id, o.id);
    addLink(tbl("business_units"), o.business_unit_id, o.id);
    addLink(tbl("exporters"), o.exporter_id, o.id);
  }

  // factories / categories via order_factory_category
  const ofc = await fetchAll<{ factory_id: string | null; category_id: string | null; order_id: string | null }>(
    "order_factory_category", "factory_id, category_id, order_id"
  );
  for (const r of ofc) {
    if (!r.order_id) continue;
    addLink(tbl("factories"), r.factory_id, r.order_id);
    addLink(tbl("categories"), r.category_id, r.order_id);
  }

  // countries via clients.country_id
  const clients = await fetchAll<{ id: string; country_id: string | null }>("clients", "id, country_id");
  const clientCountry = new Map(clients.map((c) => [c.id, c.country_id]));
  for (const o of orders) {
    const country = o.client_id ? clientCountry.get(o.client_id) : null;
    addLink(tbl("countries"), country, o.id);
  }

  // pre-loading -> set de orders (via pre_loading_batches -> batches.order_id)
  const batches = await fetchAll<{ id: string; order_id: string | null }>("batches", "id, order_id");
  const batchOrder = new Map(batches.map((b) => [b.id, b.order_id]));
  const plBatches = await fetchAll<{ pre_loading_id: string; batch_id: string }>("pre_loading_batches", "pre_loading_id, batch_id");
  const plOrders = new Map<string, Set<string>>();
  for (const r of plBatches) {
    const oid = batchOrder.get(r.batch_id);
    if (oid) addLink(plOrders, r.pre_loading_id, oid);
  }
  const spreadPl = (m: Map<string, Set<string>>, key: string | null | undefined, plId: string) => {
    if (!key) return;
    const set = plOrders.get(plId);
    if (!set) return;
    const dst = m.get(key) ?? m.set(key, new Set()).get(key)!;
    for (const oid of set) dst.add(oid);
  };

  // pods via pre_loadings.pod_id
  const pls = await fetchAll<{ id: string; pod_id: string | null }>("pre_loadings", "id, pod_id", (q) => q.is("deleted_at", null));
  for (const p of pls) spreadPl(tbl("pods"), p.pod_id, p.id);

  // cities/pols/agents/contacts via pre_loading_checklist_steps
  const steps = await fetchAll<{
    pre_loading_id: string; city_id: string | null; pol_id: string | null;
    agent_brazil_id: string | null; agent_china_id: string | null; carrier_agent_id: string | null;
    contact_brazil_id: string | null; contact_china_id: string | null;
  }>("pre_loading_checklist_steps", "pre_loading_id, city_id, pol_id, agent_brazil_id, agent_china_id, carrier_agent_id, contact_brazil_id, contact_china_id");
  for (const s of steps) {
    spreadPl(tbl("cities"), s.city_id, s.pre_loading_id);
    spreadPl(tbl("pols"), s.pol_id, s.pre_loading_id);
    spreadPl(tbl("agents"), s.agent_brazil_id, s.pre_loading_id);
    spreadPl(tbl("agents"), s.agent_china_id, s.pre_loading_id);
    spreadPl(tbl("agents"), s.carrier_agent_id, s.pre_loading_id);
    spreadPl(tbl("contacts"), s.contact_brazil_id, s.pre_loading_id);
    spreadPl(tbl("contacts"), s.contact_china_id, s.pre_loading_id);
  }

  // carriers via shipments.carrier_id
  const ships = await fetchAll<{ pre_loading_id: string; carrier_id: string | null }>("shipments", "pre_loading_id, carrier_id", (q) => q.is("deleted_at", null));
  for (const s of ships) spreadPl(tbl("carriers"), s.carrier_id, s.pre_loading_id);

  return { ordersById, byTable };
}

/**
 * `factories` também é referenciada fora de `order_factory_category` (que é o
 * que "Nº de orders" mede): como local de consolidação da carga
 * (`pre_loading_checklist_steps.consolidation_point_id`) e como local de
 * despacho do ETD (`etd_info.dispatch_location_id`). Uma fábrica com 0 orders
 * não é necessariamente "sem uso" — pode estar nessas outras pontas.
 */
async function buildFactoryOtherUsage(): Promise<Map<string, string>> {
  const consolCount = new Map<string, number>();
  const steps = await fetchAll<{ consolidation_point_id: string | null }>(
    "pre_loading_checklist_steps", "consolidation_point_id"
  );
  for (const s of steps) {
    if (!s.consolidation_point_id) continue;
    consolCount.set(s.consolidation_point_id, (consolCount.get(s.consolidation_point_id) ?? 0) + 1);
  }

  const dispatchCount = new Map<string, number>();
  const etd = await fetchAll<{ dispatch_location_id: string | null }>("etd_info", "dispatch_location_id");
  for (const e of etd) {
    if (!e.dispatch_location_id) continue;
    dispatchCount.set(e.dispatch_location_id, (dispatchCount.get(e.dispatch_location_id) ?? 0) + 1);
  }

  const out = new Map<string, string>();
  const ids = new Set([...consolCount.keys(), ...dispatchCount.keys()]);
  for (const id of ids) {
    const parts: string[] = [];
    if (consolCount.get(id)) parts.push(`Consolidation Point: ${consolCount.get(id)}x`);
    if (dispatchCount.get(id)) parts.push(`Dispatch location (ETD): ${dispatchCount.get(id)}x`);
    out.set(id, parts.join(" | "));
  }
  return out;
}

/** Colunas de Orders para uma linha (id local) de uma tabela. */
function orderCols(maps: OrderMaps, table: string, localId: string | null) {
  const empty = { "Nº de orders": "", "Última order": "", "Orders (PO)": "" };
  if (!localId) return empty;
  const set = maps.byTable.get(table)?.get(localId);
  if (!set || !set.size) return { "Nº de orders": 0, "Última order": "", "Orders (PO)": "" };
  const os = [...set].map((id) => maps.ordersById.get(id)).filter(Boolean) as Order[];
  os.sort((a, b) => String(b.date_po ?? b.created_at).localeCompare(String(a.date_po ?? a.created_at)));
  return {
    "Nº de orders": os.length,
    "Última order": (os[0]?.date_po ?? os[0]?.created_at ?? "").slice(0, 10),
    "Orders (PO)": os.slice(0, PO_LIMIT).map((o) => o.po_number).join(", ") + (os.length > PO_LIMIT ? " …" : ""),
  };
}

async function main() {
  const snap = await fetchAll<Snap>("gss_snapshot", "resource, gss_id, payload");
  const byResource = new Map<string, Snap[]>();
  for (const s of snap) (byResource.get(s.resource) ?? byResource.set(s.resource, []).get(s.resource)!).push(s);

  const maps = await buildOrderMaps();
  const factoryOtherUsage = await buildFactoryOtherUsage();
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
      Object.assign(row, orderCols(maps, rec.table, local?.id ?? null));
      if (rec.table === "factories") {
        row["Outro uso (fora de Orders)"] = local ? (factoryOtherUsage.get(local.id) ?? "") : "";
      }
      const m = mudou(g.gss_id, paired, base);
      row["Mudou desde doc anterior"] = m;
      if (m) {
        mudancas.push({
          Biblioteca: rec.label, gss_id: g.gss_id, "Nome no GSS": g.name,
          "Nome no nosso banco": local?.name ?? "",
          Antes: m === "NOVO" ? "(não existia)" : "Só no GSS",
          Agora: paired ? "Pareado" : "Só no GSS", Mudança: m,
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
      Object.assign(row, orderCols(maps, rec.table, l.id));
      if (rec.table === "factories") {
        row["Outro uso (fora de Orders)"] = factoryOtherUsage.get(l.id) ?? "";
      }
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

  // ---------- Fábricas × Orders (uma linha por fábrica × order) ----------
  const facs = await fetchAll<Local>("factories", "id, name, gss_id", (q) => q.is("deleted_at", null));
  const facById = new Map(facs.map((f) => [f.id, f]));
  const facOrders = maps.byTable.get("factories") ?? new Map();
  const fxo: any[] = [];
  for (const [facId, orderIds] of facOrders) {
    const f = facById.get(facId);
    if (!f) continue;
    for (const oid of orderIds) {
      const o = maps.ordersById.get(oid);
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

  // ---------- Mudanças (agregado NOVO/PAREOU vs doc anterior) ----------
  if (BASELINE) {
    mudancas.sort((a, b) => String(a.Biblioteca).localeCompare(String(b.Biblioteca)) || norm(a["Nome no GSS"]).localeCompare(norm(b["Nome no GSS"])));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      mudancas.length ? mudancas : [{ Biblioteca: "(sem mudanças vs baseline)" }]
    ), "Mudanças");
  }

  // ---------- Resumo (primeira aba) ----------
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), "Resumo");
  wb.SheetNames = ["Resumo", ...wb.SheetNames.filter((n) => n !== "Resumo")];

  XLSX.writeFile(wb, OUT);
  console.log(`\n✔ ${OUT}`);
  console.table(resumo);
  console.log(`Fabricas x Orders: ${fxo.length} linhas`);
}

main().catch((e) => { console.error("FALHOU:", e); process.exit(1); });
