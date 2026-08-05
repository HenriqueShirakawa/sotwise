/**
 * Recalcula `orders.status` a partir dos lotes, para TODAS as orders ativas.
 * Mesma regra do app (`rollupOrderStatus` em lib/order-status.ts) — este script
 * é a reconciliação em lote, para depois da migração do Bubble ou de qualquer
 * mudança na regra.
 *
 * Uso: npx tsx scripts/resync-order-status.ts          (só mostra o que mudaria)
 *      npx tsx scripts/resync-order-status.ts --apply  (grava)
 */
import { rollupOrderStatus } from "../lib/order-status";
import type { BatchStatus, OrderStatus } from "../types/database";
import { supabaseAdmin } from "./migrate/client";

const PAGE = 1000;

async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const chunk = data ?? [];
    out.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return out;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const orders = await fetchAll<{ id: string; po_number: string; status: OrderStatus }>((from, to) =>
    supabaseAdmin.from("orders").select("id, po_number, status").is("deleted_at", null).order("id").range(from, to)
  );
  const batches = await fetchAll<{ order_id: string; status: BatchStatus }>((from, to) =>
    supabaseAdmin.from("batches").select("order_id, status").order("id").range(from, to)
  );

  const byOrder = new Map<string, BatchStatus[]>();
  for (const b of batches) {
    const list = byOrder.get(b.order_id) ?? [];
    list.push(b.status);
    byOrder.set(b.order_id, list);
  }

  const changes = orders
    .map((o) => ({ ...o, target: rollupOrderStatus(byOrder.get(o.id) ?? [], o.status) }))
    .filter((o) => o.target !== o.status);

  console.log(`orders ativas: ${orders.length} | fora do rollup: ${changes.length}`);
  const summary = new Map<string, number>();
  for (const c of changes) {
    const key = `${c.status} -> ${c.target}`;
    summary.set(key, (summary.get(key) ?? 0) + 1);
  }
  for (const [transition, count] of [...summary].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${transition}: ${count}`);
  }

  if (!apply) {
    console.log("\n(dry run — rode com --apply para gravar)");
    return;
  }

  // Um update por status alvo, em blocos: são milhares de orders.
  const idsByTarget = new Map<OrderStatus, string[]>();
  for (const c of changes) {
    const list = idsByTarget.get(c.target) ?? [];
    list.push(c.id);
    idsByTarget.set(c.target, list);
  }
  for (const [status, ids] of idsByTarget) {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabaseAdmin
        .from("orders")
        .update({ status })
        .in("id", ids.slice(i, i + 200));
      if (error) throw new Error(`${status}: ${error.message}`);
    }
    console.log(`gravado ${status}: ${ids.length}`);
  }
}

main().catch((e) => {
  console.error("FALHOU:", e);
  process.exit(1);
});
