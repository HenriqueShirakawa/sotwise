import { scheduleClientNotificationDispatch } from "@/domain/client/notifications";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { BatchStatus, OrderStatus } from "@/types/database";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Status da Order = rollup dos lotes (planilha "StatusSOT" do cliente,
 * docs §3.7.1):
 *
 *   todos in_negotiation                      -> in_negotiation
 *   todos in_production                       -> in_production
 *   algum preloading, nem todos               -> partially_preloading
 *   todos preloading                          -> pre_loading
 *   algum in_transit, nem todos               -> partially_shipped
 *   todos in_transit                          -> shipped
 *   algum delivered, nem todos                -> partially_delivered
 *   todos delivered                           -> delivered
 *
 * A leitura é da fase mais adiantada para a mais atrasada: um lote já entregue
 * decide o status antes de um lote que ainda está em produção. Lotes
 * `canceled` não participam (docs §3.7.2) e uma Order sem nenhum lote ativo
 * mantém o status que tem — não há o que fazer rollup.
 */
export function rollupOrderStatus(
  batchStatuses: BatchStatus[],
  currentStatus: OrderStatus
): OrderStatus {
  // Cancelamento da Order é decisão explícita do usuário: os lotes são
  // devolvidos a uma fase anterior antes de cancelar, então o rollup nunca
  // "descancelaria" a Order sozinho.
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
  // Neste ponto só restam lotes in_negotiation e/ou in_production (as fases
  // seguintes já retornaram acima). Basta UM lote em produção para a Order não
  // voltar a in_negotiation — regra do cliente: adicionar um lote novo (que
  // nasce in_negotiation) não regride um pedido que já tem lote adiante. Só
  // volta a in_negotiation quando TODOS os lotes ativos estão em in_negotiation.
  if (some("in_production")) return "in_production";
  return "in_negotiation";
}

/**
 * Recalcula e grava o status das Orders informadas a partir dos lotes delas.
 * Devolve a mensagem de erro, ou `null` em caso de sucesso.
 */
export async function syncOrderStatus(admin: Admin, orderIds: string[]): Promise<string | null> {
  const ids = [...new Set(orderIds)].filter(Boolean);
  if (ids.length === 0) return null;

  const { data: orders, error: ordersError } = await admin
    .from("orders")
    .select("id, status")
    .in("id", ids);
  if (ordersError) return ordersError.message;

  const { data: batches, error: batchesError } = await admin
    .from("batches")
    .select("order_id, status")
    .in("order_id", ids);
  if (batchesError) return batchesError.message;

  const statusesByOrder = new Map<string, BatchStatus[]>();
  for (const b of batches ?? []) {
    const list = statusesByOrder.get(b.order_id) ?? [];
    list.push(b.status);
    statusesByOrder.set(b.order_id, list);
  }

  // Agrupa por status alvo pra fechar em poucos updates, não um por Order.
  const idsByTarget = new Map<OrderStatus, string[]>();
  for (const order of orders ?? []) {
    const target = rollupOrderStatus(statusesByOrder.get(order.id) ?? [], order.status);
    if (target === order.status) continue;
    const list = idsByTarget.get(target) ?? [];
    list.push(order.id);
    idsByTarget.set(target, list);
  }

  for (const [status, list] of idsByTarget) {
    const { error } = await admin.from("orders").update({ status }).in("id", list);
    if (error) return error.message;
  }

  /**
   * Notificação ao cliente (Fase 2.1). Fica AQUI, e não em cada action, pela
   * mesma razão que a captura ficou num trigger: esta função é o único ponto
   * por onde os nove caminhos de escrita de status já passam.
   *
   * Agendado para depois da resposta e sem `await` no resultado — mandar e-mail
   * não pode atrasar (nem derrubar) a ação do usuário. O evento em si já está
   * salvo na outbox pelo trigger; aqui é só o empurrão para a fila andar.
   */
  await scheduleClientNotificationDispatch();

  return null;
}

/** Mesma coisa, partindo dos lotes: resolve as Orders donas e recalcula. */
export async function syncOrderStatusForBatches(
  admin: Admin,
  batchIds: string[]
): Promise<string | null> {
  const ids = [...new Set(batchIds)].filter(Boolean);
  if (ids.length === 0) return null;

  const { data, error } = await admin.from("batches").select("order_id").in("id", ids);
  if (error) return error.message;

  return syncOrderStatus(
    admin,
    (data ?? []).map((b) => b.order_id)
  );
}
