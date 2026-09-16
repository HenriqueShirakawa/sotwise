/**
 * Documento comparativo GSS × SOTWISE, mas de ORDERS (não bibliotecas) — no
 * mesmo espírito do `gss-vs-sotwise.ts`. Só leitura, não escreve no banco nem
 * chama --commit de nada.
 *
 *   npx tsx scripts/sync-gss/orders-vs-gss.ts [saida.xlsx]
 *
 * Lado GSS: `GET /orders/` ao vivo (lib/gss/client.ts).
 * Lado nosso: tabela `orders` + joins de clients/exporters/business_units/order_types.
 * Chave de pareamento: `GSS.id` == `orders.po_number` (decisão de 2026-09-01,
 * ver memória gss-inbound-orders).
 *
 * Abas:
 *   Resumo             — contagens por status/campo
 *   Todas as Orders     — uma linha por order (GSS + nossas "só aqui"), com
 *                         todos os campos comparáveis lado a lado
 *   Exporter divergente / Order Type divergente / Customer divergente /
 *   Business Unit divergente / Só no GSS / Só no nosso banco
 *                       — recortes de conveniência da aba principal
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { gssGet } from "../../lib/gss/client";

const OUT = process.argv[2] ?? "GSS_vs_SOTWISE_orders.xlsx";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
}) as any;

type GssOrder = {
  id: number;
  customer_name: string;
  exporter_name: string | null;
  consignee_name: string | null;
  importer_name: string | null;
  leader_username: string | null;
  requester_username: string | null;
  currency: string | null;
  usd_rmb: string | null;
  down_payment: string | null;
  fob_cost_rate: string | null;
  pod_name: string | null;
  sales_representative_name: string | null;
  business_unit_name: string;
  order_type_name: string;
  is_locked: boolean;
  created_at: string;
  updated_at: string;
};

type Nossa = {
  po_number: string;
  gss_id: string | null;
  status: string;
  created_at: string;
  client_name: string | null;
  exporter_name: string | null;
  business_unit_name: string | null;
  order_type_name: string | null;
};

async function fetchAllOurs(): Promise<Nossa[]> {
  const PAGE = 1000;
  const out: Nossa[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("orders")
      .select("po_number, gss_id, status, created_at, clients(name), exporters(name), business_units(name), order_types(name)")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`orders: ${error.message}`);
    for (const r of data ?? []) {
      out.push({
        po_number: r.po_number,
        gss_id: r.gss_id,
        status: r.status,
        created_at: r.created_at,
        client_name: r.clients?.name ?? null,
        exporter_name: r.exporters?.name ?? null,
        business_unit_name: r.business_units?.name ?? null,
        order_type_name: r.order_types?.name ?? null,
      });
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const eq = (a: string | null, b: string | null) => (a ?? "") === (b ?? "");
const okDif = (a: string | null, b: string | null) => (eq(a, b) ? "OK" : "DIF");

type Row = {
  "gss_id": number | "";
  "po_number": string;
  "Status": string;
  "Customer (GSS)": string;
  "Cliente (nosso)": string;
  "Customer": string;
  "Exporter (GSS)": string;
  "Exportador (nosso)": string;
  "Exporter": string;
  "Business Unit (GSS)": string;
  "Business Unit (nosso)": string;
  "Business Unit": string;
  "Order Type (GSS)": string;
  "Order Type (nosso)": string;
  "Order Type": string;
  "Consignee (GSS)": string;
  "Importer (GSS)": string;
  "POD (GSS)": string;
  "Currency (GSS)": string;
  "USD/RMB (GSS)": string;
  "Down Payment (GSS)": string;
  "FOB Cost Rate (GSS)": string;
  "Sales Rep (GSS)": string;
  "Leader (GSS)": string;
  "Requester (GSS)": string;
  "Is Locked (GSS)": string;
  "Status (nosso, rollup)": string;
  "gss_id gravado no nosso banco?": string;
  "Created At (GSS)": string;
  "Created At (nosso)": string;
};

async function main() {
  console.log("Buscando GET /orders/ no GSS...");
  const r = await gssGet<GssOrder[]>("/orders/");
  if (!r.ok) throw new Error(`GET /orders/ falhou: ${r.error}`);
  const gss = r.data;
  console.log(`GSS: ${gss.length} orders`);

  console.log("Buscando orders no nosso banco...");
  const ours = await fetchAllOurs();
  console.log(`Nosso banco: ${ours.length} orders`);

  const ourByPo = new Map(ours.map((o) => [o.po_number, o]));
  const gssIds = new Set(gss.map((g) => String(g.id)));

  const rows: Row[] = [];

  for (const g of gss) {
    const po = String(g.id);
    const o = ourByPo.get(po);
    const custOk = o ? eq(g.customer_name, o.client_name) : false;
    const expOk = o ? eq(g.exporter_name, o.exporter_name) : false;
    const buOk = o ? eq(g.business_unit_name, o.business_unit_name) : false;
    const otOk = o ? eq(g.order_type_name, o.order_type_name) : false;
    const status = !o ? "Só no GSS" : custOk && expOk && buOk && otOk ? "Pareado — igual" : "Pareado — divergente";

    rows.push({
      gss_id: g.id,
      po_number: o?.po_number ?? "",
      Status: status,
      "Customer (GSS)": g.customer_name ?? "",
      "Cliente (nosso)": o?.client_name ?? "",
      Customer: o ? okDif(g.customer_name, o.client_name) : "—",
      "Exporter (GSS)": g.exporter_name ?? "",
      "Exportador (nosso)": o?.exporter_name ?? "",
      Exporter: o ? okDif(g.exporter_name, o.exporter_name) : "—",
      "Business Unit (GSS)": g.business_unit_name ?? "",
      "Business Unit (nosso)": o?.business_unit_name ?? "",
      "Business Unit": o ? okDif(g.business_unit_name, o.business_unit_name) : "—",
      "Order Type (GSS)": g.order_type_name ?? "",
      "Order Type (nosso)": o?.order_type_name ?? "",
      "Order Type": o ? okDif(g.order_type_name, o.order_type_name) : "—",
      "Consignee (GSS)": g.consignee_name ?? "",
      "Importer (GSS)": g.importer_name ?? "",
      "POD (GSS)": g.pod_name ?? "",
      "Currency (GSS)": g.currency ?? "",
      "USD/RMB (GSS)": g.usd_rmb ?? "",
      "Down Payment (GSS)": g.down_payment ?? "",
      "FOB Cost Rate (GSS)": g.fob_cost_rate ?? "",
      "Sales Rep (GSS)": g.sales_representative_name ?? "",
      "Leader (GSS)": g.leader_username ?? "",
      "Requester (GSS)": g.requester_username ?? "",
      "Is Locked (GSS)": g.is_locked ? "sim" : "não",
      "Status (nosso, rollup)": o?.status ?? "",
      "gss_id gravado no nosso banco?": o?.gss_id ? "sim" : "não",
      "Created At (GSS)": (g.created_at ?? "").slice(0, 10),
      "Created At (nosso)": (o?.created_at ?? "").slice(0, 10),
    });
  }

  // Nossas orders com po_number numérico sem id correspondente no GSS hoje.
  const soNosso = ours.filter((o) => /^\d+$/.test(o.po_number) && !gssIds.has(o.po_number));
  for (const o of soNosso.sort((a, b) => Number(a.po_number) - Number(b.po_number))) {
    rows.push({
      gss_id: "",
      po_number: o.po_number,
      Status: "Só no nosso banco (numérico)",
      "Customer (GSS)": "",
      "Cliente (nosso)": o.client_name ?? "",
      Customer: "—",
      "Exporter (GSS)": "",
      "Exportador (nosso)": o.exporter_name ?? "",
      Exporter: "—",
      "Business Unit (GSS)": "",
      "Business Unit (nosso)": o.business_unit_name ?? "",
      "Business Unit": "—",
      "Order Type (GSS)": "",
      "Order Type (nosso)": o.order_type_name ?? "",
      "Order Type": "—",
      "Consignee (GSS)": "",
      "Importer (GSS)": "",
      "POD (GSS)": "",
      "Currency (GSS)": "",
      "USD/RMB (GSS)": "",
      "Down Payment (GSS)": "",
      "FOB Cost Rate (GSS)": "",
      "Sales Rep (GSS)": "",
      "Leader (GSS)": "",
      "Requester (GSS)": "",
      "Is Locked (GSS)": "",
      "Status (nosso, rollup)": o.status,
      "gss_id gravado no nosso banco?": o.gss_id ? "sim" : "não",
      "Created At (GSS)": "",
      "Created At (nosso)": (o.created_at ?? "").slice(0, 10),
    });
  }

  // Não-numéricos (fantasmas do Bubble) — listados à parte, não pareáveis por natureza.
  const bubbleGhosts = ours.filter((o) => !/^\d+$/.test(o.po_number));

  // ---------- Resumo ----------
  const pareadoIgual = rows.filter((r) => r.Status === "Pareado — igual").length;
  const pareadoDif = rows.filter((r) => r.Status === "Pareado — divergente").length;
  const soGss = rows.filter((r) => r.Status === "Só no GSS").length;
  const soNossoCount = rows.filter((r) => r.Status === "Só no nosso banco (numérico)").length;

  const resumo = [
    { Métrica: "Orders no GSS (GET /orders/)", Valor: gss.length },
    { Métrica: "Orders no nosso banco (total)", Valor: ours.length },
    { Métrica: "  — po_number numérico (pareável)", Valor: ours.length - bubbleGhosts.length },
    { Métrica: "  — po_number não-numérico (fantasma Bubble)", Valor: bubbleGhosts.length },
    { Métrica: "", Valor: "" },
    { Métrica: "Pareados (id = po_number) — igual nos 4 campos", Valor: pareadoIgual },
    { Métrica: "Pareados (id = po_number) — divergente em algum campo", Valor: pareadoDif },
    { Métrica: "Só no GSS (sem po_number aqui)", Valor: soGss },
    { Métrica: "Só no nosso banco (po_number numérico sem id no GSS)", Valor: soNossoCount },
    { Métrica: "", Valor: "" },
    { Métrica: "  · Customer divergente", Valor: rows.filter((r) => r.Customer === "DIF").length },
    { Métrica: "  · Exporter divergente", Valor: rows.filter((r) => r.Exporter === "DIF").length },
    { Métrica: "  · Business Unit divergente", Valor: rows.filter((r) => r["Business Unit"] === "DIF").length },
    { Métrica: "  · Order Type divergente", Valor: rows.filter((r) => r["Order Type"] === "DIF").length },
  ];

  // ---------- Monta o workbook (poucas colunas, uma por propósito) ----------
  const wb = XLSX.utils.book_new();
  const addSheet = (nome: string, dados: Record<string, unknown>[]) => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dados.length ? dados : [{ "—": "(nenhuma linha)" }]), nome);
  };

  addSheet("Resumo", resumo);

  // "Divergências": 1 linha por pedido problemático, com o que está errado em
  // texto corrido — não precisa comparar coluna a coluna pra entender.
  const explicacao = (r: Row): string => {
    if (r.Status === "Só no GSS") return `Só existe no GSS (id ${r.gss_id}), não achei esse número aqui.`;
    if (r.Status === "Só no nosso banco (numérico)") return `Só existe aqui, não achei esse id no GSS.`;
    const partes: string[] = [];
    if (r.Customer === "DIF") partes.push(`Cliente — GSS: "${r["Customer (GSS)"]}" × nosso: "${r["Cliente (nosso)"] || "(vazio)"}"`);
    if (r.Exporter === "DIF") partes.push(`Exportador — GSS: "${r["Exporter (GSS)"]}" × nosso: "${r["Exportador (nosso)"] || "(vazio)"}"`);
    if (r["Business Unit"] === "DIF") partes.push(`Business Unit — GSS: "${r["Business Unit (GSS)"]}" × nosso: "${r["Business Unit (nosso)"] || "(vazio)"}"`);
    if (r["Order Type"] === "DIF") partes.push(`Order Type — GSS: "${r["Order Type (GSS)"]}" × nosso: "${r["Order Type (nosso)"] || "(vazio)"}"`);
    return partes.join("  |  ");
  };
  addSheet(
    "Divergências",
    rows
      .filter((r) => r.Status !== "Pareado — igual")
      .map((r) => ({
        "po_number": r.po_number || r.gss_id,
        "Cliente": r["Cliente (nosso)"] || r["Customer (GSS)"],
        "O que diverge": explicacao(r),
      }))
  );

  addSheet(
    "Exporter divergente",
    rows
      .filter((r) => r.Exporter === "DIF")
      .map((r) => ({ po_number: r.po_number, Cliente: r["Cliente (nosso)"], "Exporter (GSS)": r["Exporter (GSS)"], "Exportador (nosso)": r["Exportador (nosso)"] || "(vazio)" }))
  );
  addSheet(
    "Order Type divergente",
    rows
      .filter((r) => r["Order Type"] === "DIF")
      .map((r) => ({ po_number: r.po_number, Cliente: r["Cliente (nosso)"], "Order Type (GSS)": r["Order Type (GSS)"], "Order Type (nosso)": r["Order Type (nosso)"] || "(vazio)" }))
  );
  addSheet(
    "Customer divergente",
    rows
      .filter((r) => r.Customer === "DIF")
      .map((r) => ({ po_number: r.po_number, "Customer (GSS)": r["Customer (GSS)"], "Cliente (nosso)": r["Cliente (nosso)"] || "(vazio)" }))
  );
  addSheet(
    "Business Unit divergente",
    rows
      .filter((r) => r["Business Unit"] === "DIF")
      .map((r) => ({ po_number: r.po_number, Cliente: r["Cliente (nosso)"], "Business Unit (GSS)": r["Business Unit (GSS)"], "Business Unit (nosso)": r["Business Unit (nosso)"] || "(vazio)" }))
  );
  addSheet(
    "So no GSS",
    rows
      .filter((r) => r.Status === "Só no GSS")
      .map((r) => ({ gss_id: r.gss_id, Cliente: r["Customer (GSS)"], "Business Unit": r["Business Unit (GSS)"], "Order Type": r["Order Type (GSS)"], "Criado em (GSS)": r["Created At (GSS)"] }))
  );
  addSheet(
    "So no nosso banco",
    rows
      .filter((r) => r.Status === "Só no nosso banco (numérico)")
      .map((r) => ({ po_number: r.po_number, Cliente: r["Cliente (nosso)"], "Business Unit": r["Business Unit (nosso)"], "Order Type": r["Order Type (nosso)"], Status: r["Status (nosso, rollup)"], "Criado em": r["Created At (nosso)"] }))
  );

  XLSX.writeFile(wb, OUT);
  console.log(`\n✔ ${OUT}`);
  console.table(resumo);
}

main().catch((e) => {
  console.error("FALHOU:", e);
  process.exit(1);
});
