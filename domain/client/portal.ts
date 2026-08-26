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
 *  - datas de ETD, quantidade e descrição de produto → não modeladas no banco
 *    (ou estimativa interna, no caso do ETD); não dá para expor o que não existe.
 *
 * Nota (2026-08-26): a decisão de 2026-08-18 que escondia o NÚMERO DO LOTE foi
 * revertida a pedido do Henrique — o cliente agora vê o lote (`.01/.02`) e a
 * quebra por lote, para o portal casar com o desenho do Claude Design. O que
 * segue de fora é só o que a AGK não quer mostrar (campos internos) ou o que o
 * banco não guarda (quantidade, descrição, ETA por lote). Ver
 * docs/regras_de_negocio.md.
 */

export type ClientOrder = {
  id: string;
  po_number: string;
  client_reference: string | null;
  type: string | null;
  status: OrderStatus;
  /** Data pedida de embarque (orders.schedule_requested). */
  scheduleRequested: string | null;
  /** Números dos lotes do pedido (`.01`, `.02`…), em ordem. */
  batchNumbers: string[];
  /** Quantos itens do pedido estão em cada estágio. */
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
      schedule_requested: string | null;
      status: OrderStatus;
      created_at: string;
    }>((from, to) =>
      admin
        .from("orders")
        .select(
          "id, po_number, client_reference, order_type_id, schedule_requested, status, created_at"
        )
        .eq("client_id", clientId)
        .is("deleted_at", null)
        .not("status", "in", `(${HIDDEN_FROM_CLIENT.join(",")})`)
        .range(from, to)
    ),
    // Filtra pelo dono do pedido no próprio join, em vez de baixar os lotes e
    // cruzar em memória: sem o `!inner` + `eq` o escopo dependeria de o código
    // acertar o filtro depois, e é exatamente aí que vazamento nasce.
    fetchAll<{ order_id: string; batch_number: string; status: BatchStatus }>((from, to) =>
      admin
        .from("batches")
        .select("order_id, batch_number, status, orders!inner(client_id)")
        .eq("orders.client_id", clientId)
        .range(from, to)
        .returns<{ order_id: string; batch_number: string; status: BatchStatus }[]>()
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("order_types").select("id, name").is("deleted_at", null).range(from, to)
    ),
  ]);

  const typeName = new Map(types.map((t) => [t.id, t.name]));

  // order → { status → contagem }. Map aninhado em vez de array para a soma sair
  // numa passada só sobre os lotes.
  const byOrder = new Map<string, Map<BatchStatus, number>>();
  // order → números dos lotes (para a coluna Batch No.).
  const batchNumbersByOrder = new Map<string, string[]>();
  for (const b of batches) {
    const counts = byOrder.get(b.order_id) ?? new Map<BatchStatus, number>();
    counts.set(b.status, (counts.get(b.status) ?? 0) + 1);
    byOrder.set(b.order_id, counts);

    const nums = batchNumbersByOrder.get(b.order_id) ?? [];
    nums.push(b.batch_number);
    batchNumbersByOrder.set(b.order_id, nums);
  }

  const rows: ClientOrder[] = orders.map((o) => ({
    id: o.id,
    po_number: o.po_number,
    client_reference: o.client_reference,
    type: o.order_type_id ? typeName.get(o.order_type_id) ?? null : null,
    status: o.status,
    scheduleRequested: o.schedule_requested,
    batchNumbers: (batchNumbersByOrder.get(o.id) ?? []).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    ),
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
 * Detalhe de UM pedido para o portal — os LOTES do pedido e quais produtos
 * (categorias) viajam em cada um. É a promessa do painel do cliente: "veja onde
 * cada lote está e exatamente quais produtos viajam nele".
 *
 * Recorte (revisto 2026-08-26): o número do lote AGORA aparece (a decisão de
 * 2026-08-18 que o escondia foi revertida — ver o cabeçalho do arquivo). Segue
 * de fora o que é interno da AGK (fábrica, exporter, ETD) e o que o banco não
 * guarda (quantidade, descrição de produto, ETA por lote). O produto continua
 * na granularidade de CATEGORIA, que é o que o `order_factory_category` fixa.
 *
 * O `clientId` entra no próprio filtro do pedido — é a única fronteira entre um
 * cliente e o de outro. `orderId` vem da URL; sozinho não é confiável, por isso
 * a query exige as duas colunas e devolve `null` (→ notFound) quando o pedido
 * não é deste cliente.
 */
export type ClientOrderBatch = {
  id: string;
  /** Número do lote (`.01`, `.02`…). */
  code: string;
  status: BatchStatus;
  label: string;
  /** Produtos (categorias) que viajam neste lote. Ordenados por nome. */
  products: string[];
};

export type ClientOrderDetail = {
  id: string;
  po_number: string;
  client_reference: string | null;
  type: string | null;
  status: OrderStatus;
  /** Data pedida de embarque (orders.schedule_requested). */
  scheduleRequested: string | null;
  /** Lotes do pedido, ordenados pelo número. */
  batches: ClientOrderBatch[];
  /** Produtos do pedido ainda sem lote — não começaram a viajar. */
  pendingProducts: string[];
};

export async function loadClientOrderDetail(
  clientId: string,
  orderId: string
): Promise<ClientOrderDetail | null> {
  const admin = createAdminClient();

  const { data: order } = await admin
    .from("orders")
    .select("id, po_number, client_reference, order_type_id, schedule_requested, status")
    .eq("id", orderId)
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .not("status", "in", `(${HIDDEN_FROM_CLIENT.join(",")})`)
    .single();

  if (!order) return null;

  const [batches, ofc, categories, orderType] = await Promise.all([
    fetchAll<{ id: string; batch_number: string; status: BatchStatus }>((from, to) =>
      admin
        .from("batches")
        .select("id, batch_number, status")
        .eq("order_id", orderId)
        .range(from, to)
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

  // lote → produtos (Set para deduplicar: a mesma categoria pode aparecer em
  // mais de uma entrada Factory×Category dentro do mesmo lote).
  const byBatch = new Map<string, Set<string>>();
  const pending = new Set<string>();
  for (const row of ofc) {
    const name = categoryName.get(row.category_id)?.trim();
    if (!name) continue;
    if (!row.batch_id) {
      pending.add(name);
      continue;
    }
    const set = byBatch.get(row.batch_id) ?? new Set<string>();
    set.add(name);
    byBatch.set(row.batch_id, set);
  }

  const clientBatches: ClientOrderBatch[] = batches
    .map((b) => ({
      id: b.id,
      code: b.batch_number,
      status: b.status,
      label: BATCH_STATUS_LABELS[b.status],
      products: [...(byBatch.get(b.id) ?? new Set<string>())].sort((a, b) =>
        a.localeCompare(b)
      ),
    }))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  return {
    id: order.id,
    po_number: order.po_number,
    client_reference: order.client_reference,
    type: orderType.data?.name ?? null,
    status: order.status,
    scheduleRequested: order.schedule_requested,
    batches: clientBatches,
    pendingProducts: [...pending].sort((a, b) => a.localeCompare(b)),
  };
}
