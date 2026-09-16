/**
 * Corrige lotes que ficaram para trás quando o shipment já está `delivered`.
 * batch -> delivered, depois rollup de orders.status (mesma regra de
 * lib/order-status.ts). Não importa esse módulo direto: ele puxa
 * domain/client/notifications.ts, que usa `server-only` e quebra fora do
 * Next. Rollup replicado aqui só com a função pura.
 *
 * Uso: npx tsx scripts/.tmp-fix-delivered-batch-mismatch.ts          (dry run)
 *      npx tsx scripts/.tmp-fix-delivered-batch-mismatch.ts --apply  (grava)
 */
import { supabaseAdmin as admin } from "./migrate/client";

type BatchStatus = "in_negotiation" | "in_production" | "preloading" | "in_transit" | "delivered" | "canceled";
type OrderStatus =
  | "in_negotiation"
  | "in_production"
  | "partially_preloading"
  | "pre_loading"
  | "partially_shipped"
  | "shipped"
  | "partially_delivered"
  | "delivered"
  | "canceled";

// Cópia fiel de rollupOrderStatus (lib/order-status.ts) — ver comentário acima.
function rollupOrderStatus(batchStatuses: BatchStatus[], currentStatus: OrderStatus): OrderStatus {
  if (currentStatus === "canceled") return "canceled";
  const active = batchStatuses.filter((s) => s !== "canceled");
  if (active.length === 0) return currentStatus;
  const all = (s: BatchStatus) => active.every((x) => x === s);
  const some = (s: BatchStatus) => active.some((x) => x === s);
  if (all("delivered")) return "delivered";
  if (some("delivered")) return "partially_delivered";
  if (all("in_transit")) return "shipped";
  if (some("in_transit")) return "partially_shipped";
  if (all("preloading")) return "pre_loading";
  if (some("preloading")) return "partially_preloading";
  if (some("in_production")) return "in_production";
  return "in_negotiation";
}

const PAGE = 1000;

async function main() {
  const apply = process.argv.includes("--apply");

  let shipments: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("shipments")
      .select(
        `id, status,
         pre_loadings ( pl_number,
           pre_loading_batches ( batches ( id, batch_number, status, order_id, orders ( po_number ) ) ) )`
      )
      .ilike("status", "delivered")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    shipments = shipments.concat(data ?? []);
    if (!data || data.length < PAGE) break;
  }

  const toFix: { batchId: string; orderId: string; label: string }[] = [];
  for (const s of shipments) {
    const links = s.pre_loadings?.pre_loading_batches ?? [];
    for (const l of links) {
      const b = l.batches;
      if (b && (b.status ?? "").toLowerCase() !== "delivered") {
        toFix.push({
          batchId: b.id,
          orderId: b.order_id,
          label: `PL ${s.pre_loadings?.pl_number} / PO ${b.orders?.po_number} / lote ${b.batch_number}: ${b.status} -> delivered`,
        });
      }
    }
  }

  console.log(`Lotes a corrigir: ${toFix.length}`);
  for (const t of toFix) console.log(`  ${t.label}`);

  if (!apply) {
    console.log("\n(dry run — rode com --apply para gravar)");
    return;
  }
  if (toFix.length === 0) return;

  const batchIds = toFix.map((t) => t.batchId);
  const { error: updErr } = await admin.from("batches").update({ status: "delivered" }).in("id", batchIds);
  if (updErr) throw new Error(`update batches: ${updErr.message}`);
  console.log(`\nbatches.status gravado como delivered: ${batchIds.length}`);

  const orderIds = [...new Set(toFix.map((t) => t.orderId))];
  const { data: orders, error: ordErr } = await admin.from("orders").select("id, po_number, status").in("id", orderIds);
  if (ordErr) throw new Error(`select orders: ${ordErr.message}`);
  const { data: allBatches, error: bErr } = await admin.from("batches").select("order_id, status").in("order_id", orderIds);
  if (bErr) throw new Error(`select batches: ${bErr.message}`);

  const statusesByOrder = new Map<string, BatchStatus[]>();
  for (const b of allBatches ?? []) {
    const list = statusesByOrder.get(b.order_id) ?? [];
    list.push(b.status as BatchStatus);
    statusesByOrder.set(b.order_id, list);
  }

  for (const o of orders ?? []) {
    const target = rollupOrderStatus(statusesByOrder.get(o.id) ?? [], o.status as OrderStatus);
    if (target === o.status) {
      console.log(`  order PO ${o.po_number}: já ${o.status} (sem mudança)`);
      continue;
    }
    const { error } = await admin.from("orders").update({ status: target }).eq("id", o.id);
    if (error) throw new Error(`update order ${o.po_number}: ${error.message}`);
    console.log(`  order PO ${o.po_number}: ${o.status} -> ${target}`);
  }
}

main().catch((e) => {
  console.error("FALHOU:", e);
  process.exit(1);
});
