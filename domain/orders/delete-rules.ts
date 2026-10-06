import type { createAdminClient } from "@/lib/supabase/admin";
import type { OrderStatus } from "@/types/database";

/**
 * Regras de exclusão de Order — usadas pela lixeira da tela
 * (app/(dashboard)/orders/actions.ts → deleteOrder) e pelo
 * DELETE /api/orders/{id} (domain/orders/api-write.ts).
 */

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Status em que uma Order pode ser excluída. Depois de entrar num Pre-loading/
 * embarque ela tem PL/Shipment dependentes — apagá-la deixaria órfãos, então só
 * as fases iniciais (ou uma order cancelada) são deletáveis. A UI desabilita a
 * lixeira nos demais status; aqui é a trava de servidor.
 */
export const DELETABLE_ORDER_STATUSES = new Set<OrderStatus>([
  "in_negotiation",
  "in_production",
  "canceled",
]);

/**
 * Diz se algum lote da order já entrou num Pre-loading (e se aquele Pre-loading
 * virou Shipment). Devolve o rótulo pronto para a mensagem de erro, ou null se
 * a order estiver solta e puder ser apagada.
 */
export async function findLinkedShipping(
  admin: AdminClient,
  orderId: string
): Promise<{ kind: "pre-loading" | "shipment"; number: string } | null> {
  const { data: batches } = await admin
    .from("batches")
    .select("id")
    .eq("order_id", orderId);
  const batchIds = (batches ?? []).map((b) => b.id);
  if (!batchIds.length) return null;

  const { data: links } = await admin
    .from("pre_loading_batches")
    .select("pre_loading_id")
    .in("batch_id", batchIds)
    .limit(1);
  const preLoadingId = links?.[0]?.pre_loading_id;
  if (!preLoadingId) return null;

  const [{ data: preLoading }, { data: shipment }] = await Promise.all([
    admin.from("pre_loadings").select("pl_number").eq("id", preLoadingId).maybeSingle(),
    admin.from("shipments").select("id").eq("pre_loading_id", preLoadingId).maybeSingle(),
  ]);

  return {
    kind: shipment ? "shipment" : "pre-loading",
    number: preLoading?.pl_number ?? "—",
  };
}

/**
 * Hard delete de uma Order com as travas acima. A order sai de vez e, em
 * cascata, vão os lotes, OFC/ETD e o checklist (FKs order_id ON DELETE CASCADE).
 *
 * Order com embarque não pode ser apagada. O delete é em cascata e solta o
 * vínculo em pre_loading_batches, mas NÃO remove o Pre-loading nem o Shipment:
 * eles sobravam sem pedido de origem, invisíveis nas listagens e sem botão para
 * limpar — foi o que travou a numeração no QA de 05/08. Bloquear em vez de
 * cascatear é a escolha reversível: o usuário desfaz o embarque e só então
 * apaga o pedido; cascatear destruiria um embarque real num clique, sem lixeira
 * para recuperar.
 */
export async function deleteOrderWithRules(
  admin: AdminClient,
  orderId: string
): Promise<{ ok: true } | { ok: false; status: 404 | 409 | 500; error: string }> {
  const { data: order, error: readError } = await admin
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .maybeSingle();
  if (readError) return { ok: false, status: 500, error: readError.message };
  if (!order) return { ok: false, status: 404, error: "Order not found." };
  if (!DELETABLE_ORDER_STATUSES.has(order.status)) {
    return {
      ok: false,
      status: 409,
      error: "Only orders in Negotiation, Production or Canceled can be deleted.",
    };
  }

  const linked = await findLinkedShipping(admin, orderId);
  if (linked) {
    return {
      ok: false,
      status: 409,
      error: `This order is already in ${linked.kind} ${linked.number}. Remove it from there before deleting the order.`,
    };
  }

  const { error } = await admin.from("orders").delete().eq("id", orderId);
  if (error) return { ok: false, status: 500, error: error.message };
  return { ok: true };
}
