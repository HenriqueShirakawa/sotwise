import "server-only";

import { fetchAll } from "@/lib/fetch-all";
import { BATCH_STATUS_LABELS } from "@/lib/status-colors";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BatchStatus, OrderStatus } from "@/types/database";

/**
 * Leitura do portal do cliente externo.
 *
 * Todo acesso do app sai pelo `service_role` (RLS deny-all), então não existe
 * rede de proteção no banco: o `clientId` que chega aqui é a ÚNICA fronteira
 * entre um cliente e os pedidos dos outros. Por isso ele é parâmetro
 * obrigatório e vem de `requireClientScope()` — nunca de query string, nunca do
 * corpo de um request.
 *
 * O DTO é deliberadamente magro. O que fica de fora não é esquecimento:
 *  - fábrica, exporter, leader, requester, BU → operação interna da AGK;
 *  - número do lote → o cliente acompanha PRODUTO, não lote (decisão de
 *    2026-08-18); o lote entra só como contagem por estágio;
 *  - datas de ETD → estimativa interna; expor ou não a um terceiro é decisão de
 *    negócio que ainda não foi tomada.
 */

export type ClientOrder = {
  id: string;
  po_number: string;
  client_reference: string | null;
  type: string | null;
  status: OrderStatus;
  /** Quantos itens do pedido estão em cada estágio. Sem identificar o lote. */
  progress: { label: string; count: number }[];
};

/**
 * Pedido em negociação não aparece: enquanto não vira produção é conversa
 * comercial, não acompanhamento (mesma régua da notificação por e-mail —
 * `in_negotiation` não dispara nada). Cancelado APARECE: sumir em silêncio com
 * um pedido que o cliente conhece é pior do que mostrá-lo cancelado.
 */
const HIDDEN_FROM_CLIENT: OrderStatus[] = ["in_negotiation"];

export async function loadClientOrders(clientId: string): Promise<ClientOrder[]> {
  const admin = createAdminClient();

  const [orders, batches, types] = await Promise.all([
    fetchAll<{
      id: string;
      po_number: string;
      client_reference: string | null;
      order_type_id: string | null;
      status: OrderStatus;
      created_at: string;
    }>((from, to) =>
      admin
        .from("orders")
        .select("id, po_number, client_reference, order_type_id, status, created_at")
        .eq("client_id", clientId)
        .is("deleted_at", null)
        .not("status", "in", `(${HIDDEN_FROM_CLIENT.join(",")})`)
        .range(from, to)
    ),
    // Filtra pelo dono do pedido no próprio join, em vez de baixar os lotes e
    // cruzar em memória: sem o `!inner` + `eq` o escopo dependeria de o código
    // acertar o filtro depois, e é exatamente aí que vazamento nasce.
    fetchAll<{ order_id: string; status: BatchStatus }>((from, to) =>
      admin
        .from("batches")
        .select("order_id, status, orders!inner(client_id)")
        .eq("orders.client_id", clientId)
        .range(from, to)
        .returns<{ order_id: string; status: BatchStatus }[]>()
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("order_types").select("id, name").is("deleted_at", null).range(from, to)
    ),
  ]);

  const typeName = new Map(types.map((t) => [t.id, t.name]));

  // order → { status → contagem }. Map aninhado em vez de array para a soma sair
  // numa passada só sobre os lotes.
  const byOrder = new Map<string, Map<BatchStatus, number>>();
  for (const b of batches) {
    const counts = byOrder.get(b.order_id) ?? new Map<BatchStatus, number>();
    counts.set(b.status, (counts.get(b.status) ?? 0) + 1);
    byOrder.set(b.order_id, counts);
  }

  const rows: ClientOrder[] = orders.map((o) => ({
    id: o.id,
    po_number: o.po_number,
    client_reference: o.client_reference,
    type: o.order_type_id ? typeName.get(o.order_type_id) ?? null : null,
    status: o.status,
    progress: [...(byOrder.get(o.id) ?? new Map())]
      .map(([status, count]) => ({
        label: BATCH_STATUS_LABELS[status as BatchStatus],
        count: count as number,
      }))
      .sort((a, b) => b.count - a.count),
  }));

  // Mais recente primeiro, no mesmo critério da lista interna: o PO number é
  // sequencial, então ordenar por ele numericamente é ordenar por recência.
  rows.sort((a, b) => (Number(b.po_number) || 0) - (Number(a.po_number) || 0));

  return rows;
}

/**
 * Detalhe de UM pedido para o portal — os produtos e em que estágio cada um
 * viaja. É a promessa do painel do cliente: "veja onde cada lote está e
 * exatamente quais produtos viajam nele".
 *
 * Mesmas regras de recorte do DTO da lista: nada de número de lote, fábrica,
 * exporter, ETD ou qualquer campo interno. O cliente enxerga PRODUTO × ESTÁGIO,
 * porque é isso que ele reconhece (decisão de 2026-08-18).
 *
 * O `clientId` entra no próprio filtro do pedido — é a única fronteira entre um
 * cliente e o de outro. `orderId` vem da URL; sozinho não é confiável, por isso
 * a query exige as duas colunas e devolve `null` (→ notFound) quando o pedido
 * não é deste cliente.
 */
export type ClientOrderStage = {
  status: BatchStatus;
  label: string;
  /** Produtos (categorias) que estão neste estágio. Ordenados por nome. */
  products: string[];
};

export type ClientOrderDetail = {
  id: string;
  po_number: string;
  client_reference: string | null;
  type: string | null;
  status: OrderStatus;
  /** Produtos agrupados por estágio, na ordem do ciclo de vida. */
  stages: ClientOrderStage[];
  /** Produtos do pedido ainda sem lote — não começaram a viajar. */
  pendingProducts: string[];
};

// Ciclo de vida do lote, da produção à entrega. `canceled` por último: quando
// aparece, é exceção, não etapa do fluxo feliz.
const STAGE_ORDER: BatchStatus[] = [
  "in_negotiation",
  "in_production",
  "preloading",
  "in_transit",
  "delivered",
  "canceled",
];

export async function loadClientOrderDetail(
  clientId: string,
  orderId: string
): Promise<ClientOrderDetail | null> {
  const admin = createAdminClient();

  const { data: order } = await admin
    .from("orders")
    .select("id, po_number, client_reference, order_type_id, status")
    .eq("id", orderId)
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .not("status", "in", `(${HIDDEN_FROM_CLIENT.join(",")})`)
    .single();

  if (!order) return null;

  const [batches, ofc, categories, orderType] = await Promise.all([
    fetchAll<{ id: string; status: BatchStatus }>((from, to) =>
      admin.from("batches").select("id, status").eq("order_id", orderId).range(from, to)
    ),
    fetchAll<{ batch_id: string | null; category_id: string }>((from, to) =>
      admin
        .from("order_factory_category")
        .select("batch_id, category_id")
        .eq("order_id", orderId)
        .range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("categories").select("id, name").is("deleted_at", null).range(from, to)
    ),
    order.order_type_id
      ? admin.from("order_types").select("name").eq("id", order.order_type_id).single()
      : Promise.resolve({ data: null as { name: string } | null }),
  ]);

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const batchStatus = new Map(batches.map((b) => [b.id, b.status]));

  // estágio → produtos (Set para deduplicar: o mesmo produto pode estar em mais
  // de um lote no mesmo estágio).
  const byStage = new Map<BatchStatus, Set<string>>();
  const pending = new Set<string>();
  for (const row of ofc) {
    const name = categoryName.get(row.category_id)?.trim();
    if (!name) continue;
    const status = row.batch_id ? batchStatus.get(row.batch_id) : undefined;
    if (!status) {
      pending.add(name);
      continue;
    }
    const set = byStage.get(status) ?? new Set<string>();
    set.add(name);
    byStage.set(status, set);
  }

  const stages: ClientOrderStage[] = STAGE_ORDER.filter((s) => byStage.has(s)).map((s) => ({
    status: s,
    label: BATCH_STATUS_LABELS[s],
    products: [...byStage.get(s)!].sort((a, b) => a.localeCompare(b)),
  }));

  return {
    id: order.id,
    po_number: order.po_number,
    client_reference: order.client_reference,
    type: orderType.data?.name ?? null,
    status: order.status,
    stages,
    pendingProducts: [...pending].sort((a, b) => a.localeCompare(b)),
  };
}
