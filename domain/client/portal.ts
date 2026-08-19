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
