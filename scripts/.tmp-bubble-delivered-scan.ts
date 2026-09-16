/**
 * Mesma varredura (shipment Delivered com lote != Delivered), mas direto na
 * FONTE (Bubble), não no Supabase já migrado. `Status Batch OS` (bloqueado
 * por privacy rule em 28/07, ver migracao-status-lote-bug) está de volta
 * legível pela API pública.
 *
 * Uso: npx tsx scripts/.tmp-bubble-delivered-scan.ts
 */
import { fetchAll } from "./migrate/bubble";

function norm(v: unknown): string {
  return String(v ?? "").toLowerCase();
}
function batchStatus(label: unknown): string {
  const s = norm(label);
  if (s.includes("transit")) return "in_transit";
  if (s.includes("deliver")) return "delivered";
  if (s.includes("pre-load") || s.includes("preload")) return "preloading";
  if (s.includes("production")) return "in_production";
  if (s.includes("cancel") || s.includes("duplicate")) return "canceled";
  return "in_negotiation";
}
function shipmentStatus(label: unknown): string {
  const s = norm(label);
  if (s.includes("deliver")) return "delivered";
  if (s.includes("cancel")) return "canceled";
  return "in_transit";
}

async function main() {
  console.log("Buscando orders...");
  const orders = await fetchAll("[vistapub]order");
  const poByOrderId = new Map(orders.map((o) => [o._id, String(o["Number PO text"] ?? o._id)]));

  console.log("Buscando pre-loadings...");
  const preloadings = await fetchAll("[vistapub]pre-loading");
  const plById = new Map(preloadings.map((p) => [p._id, p]));

  console.log("Buscando lotes (orderxlotexpl)...");
  const lotes = await fetchAll("[vistapub]orderxlotexpl");
  const loteById = new Map(lotes.map((l) => [l._id, l]));

  console.log("Buscando shipments...");
  const shipments = await fetchAll("[vistapub]shippment");

  const delivered = shipments.filter((s) => shipmentStatus(s["[Header] Status_OS"]) === "delivered");
  console.log(`\nShipments Delivered no Bubble: ${delivered.length}`);

  const mismatches: string[] = [];
  for (const s of delivered) {
    const plId = s["[Vistapub] Pre-Loading"] as string | undefined;
    const pl = plId ? plById.get(plId) : undefined;
    const plNumber = pl ? String(pl["PL Number Txt"] ?? pl["PL Number"] ?? plId) : "(sem PL)";
    const loteIds = (pl && Array.isArray(pl["List of Order x Lote x PL"]) ? pl["List of Order x Lote x PL"] : []) as string[];

    for (const lid of loteIds) {
      const l = loteById.get(lid);
      if (!l) continue;
      const st = batchStatus(l["Status Batch OS"]);
      if (st !== "delivered") {
        const orderId = l["Order"] as string | undefined;
        const po = orderId ? (poByOrderId.get(orderId) ?? orderId) : "?";
        const loteNum = l["Lote (Number)"];
        mismatches.push(
          `PL ${plNumber} / PO ${po} / lote #${loteNum} (${lid}): "${l["Status Batch OS"]}" -> ${st}`
        );
      }
    }
  }

  console.log(`\nLotes fora de sincronia no BUBBLE: ${mismatches.length}`);
  for (const m of mismatches) console.log("  " + m);
}

main().catch((e) => {
  console.error("FALHOU:", e);
  process.exit(1);
});
