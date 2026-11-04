import "server-only";

import { fetchAll } from "@/lib/fetch-all";
import { BATCH_STATUS_LABELS } from "@/lib/status-colors";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayIso } from "@/lib/format";
import type { BatchStatus, ChecklistStep, OrderStatus } from "@/types/database";

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
  /**
   * % do ciclo In Production → Delivered, média dos lotes do pedido (cada lote
   * vale 25/50/75/100 pelo passo em que está — a mesma régua do stepper do
   * detalhe). Pedido entregue = 100; sem lote no fluxo = 0.
   */
  progressPct: number;
  /** ETA ao Brasil (passo `eta_brazil` do checklist), igual ao detalhe. */
  etaBrazil: string | null;
  /** Entrega efetiva (passo `delivered`/`ata_brazil`), quando houver. */
  deliveredOn: string | null;
  /** Linhas de produto ativas (Factory×Category), sem deduplicar — igual ao detalhe. */
  itemCount: number;
  /** Categorias distintas do pedido, por nome. */
  categories: string[];
  /** Aba de "My orders": entregue, cancelado ou em andamento. */
  bucket: ClientOrderBucket;
};

export type ClientOrderBucket = "in_progress" | "delivered" | "canceled";

type ChecklistDates = {
  step: ChecklistStep;
  enabled: boolean;
  estimated_date: string | null;
  completed_on: string | null;
};

/** Peso de cada passo do lote no % de progresso (mesma ordem do stepper). */
const BATCH_PROGRESS: Partial<Record<BatchStatus, number>> = {
  in_production: 25,
  preloading: 50,
  in_transit: 75,
  delivered: 100,
};

function bucketOf(status: OrderStatus): ClientOrderBucket {
  if (status === "delivered") return "delivered";
  if (status === "canceled") return "canceled";
  return "in_progress";
}

/**
 * ETA e entrega a partir dos passos do checklist do pedido. Passo desabilitado
 * (enabled=false) não conta. Mesma regra no detalhe e na lista.
 */
function etaAndDelivery(steps: ChecklistDates[]): {
  etaBrazil: string | null;
  deliveredOn: string | null;
} {
  const stepOf = new Map(steps.filter((s) => s.enabled !== false).map((s) => [s.step, s]));
  const etaStep = stepOf.get("eta_brazil");
  return {
    etaBrazil: etaStep?.estimated_date ?? etaStep?.completed_on ?? null,
    deliveredOn:
      stepOf.get("delivered")?.completed_on ?? stepOf.get("ata_brazil")?.completed_on ?? null,
  };
}

/**
 * Fallback quando o pedido não tem lote no fluxo (ainda não chegou do GSS, ou
 * todos cancelados): o % segue o status do próprio pedido, para a barra não
 * dizer 0% ao lado de um selo "Pre-Loading".
 */
const ORDER_PROGRESS: Partial<Record<OrderStatus, number>> = {
  in_production: 25,
  pre_loading: 50,
  partially_shipped: 75,
  shipped: 75,
  partially_delivered: 75,
  delivered: 100,
};

function progressPctOf(
  status: OrderStatus,
  counts: Map<BatchStatus, number> | undefined
): number {
  if (status === "delivered") return 100;
  let sum = 0;
  let n = 0;
  for (const [batchStatus, count] of counts ?? []) {
    const weight = BATCH_PROGRESS[batchStatus];
    // Lote cancelado/em negociação está fora do ciclo — não puxa a média.
    if (weight === undefined) continue;
    sum += weight * count;
    n += count;
  }
  return n === 0 ? ORDER_PROGRESS[status] ?? 0 : Math.round(sum / n);
}

/**
 * Pedido em negociação não aparece: enquanto não vira produção é conversa
 * comercial, não acompanhamento (mesma régua da notificação por e-mail —
 * `in_negotiation` não dispara nada). Cancelado APARECE: sumir em silêncio com
 * um pedido que o cliente conhece é pior do que mostrá-lo cancelado.
 */
const HIDDEN_FROM_CLIENT: OrderStatus[] = ["in_negotiation"];

export async function loadClientOrders(clientId: string): Promise<ClientOrder[]> {
  const admin = createAdminClient();

  const [orders, batches, types, steps, ofc, categories] = await Promise.all([
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
    // Mesmo escopo pelo join (`orders!inner` + client_id) da leitura de lotes.
    fetchAll<ChecklistDates & { order_id: string }>((from, to) =>
      admin
        .from("order_checklist_steps")
        .select("order_id, step, enabled, estimated_date, completed_on, orders!inner(client_id)")
        .eq("orders.client_id", clientId)
        .in("step", ["eta_brazil", "ata_brazil", "delivered"])
        .range(from, to)
        .returns<(ChecklistDates & { order_id: string })[]>()
    ),
    fetchAll<{ order_id: string; category_id: string }>((from, to) =>
      admin
        .from("order_factory_category")
        .select("order_id, category_id, orders!inner(client_id)")
        .eq("orders.client_id", clientId)
        .eq("is_active", true)
        .range(from, to)
        .returns<{ order_id: string; category_id: string }[]>()
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("categories").select("id, name").is("deleted_at", null).range(from, to)
    ),
  ]);

  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name.trim()]));

  const stepsByOrder = new Map<string, ChecklistDates[]>();
  for (const st of steps) {
    const list = stepsByOrder.get(st.order_id) ?? [];
    list.push(st);
    stepsByOrder.set(st.order_id, list);
  }

  // order → { linhas de produto, categorias distintas }.
  const itemsByOrder = new Map<string, { count: number; categories: Set<string> }>();
  for (const row of ofc) {
    const entry = itemsByOrder.get(row.order_id) ?? { count: 0, categories: new Set<string>() };
    entry.count += 1;
    const name = categoryName.get(row.category_id);
    if (name) entry.categories.add(name);
    itemsByOrder.set(row.order_id, entry);
  }

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
    progressPct: progressPctOf(o.status, byOrder.get(o.id)),
    ...etaAndDelivery(stepsByOrder.get(o.id) ?? []),
    itemCount: itemsByOrder.get(o.id)?.count ?? 0,
    categories: [...(itemsByOrder.get(o.id)?.categories ?? [])].sort((a, b) =>
      a.localeCompare(b)
    ),
    bucket: bucketOf(o.status),
  }));

  // Mais recente primeiro, no mesmo critério da lista interna: o PO number é
  // sequencial, então ordenar por ele numericamente é ordenar por recência.
  rows.sort((a, b) => (Number(b.po_number) || 0) - (Number(a.po_number) || 0));

  return rows;
}

/**
 * Números do Dashboard do portal, derivados da mesma lista de "My orders" —
 * uma leitura só, e os dois nunca discordam.
 *
 * "Precisa de atenção" = em andamento, com ETA ao Brasil já passada e sem
 * entrega registrada. "Próxima entrega" = a menor ETA de hoje em diante entre
 * os em andamento. "Hoje" é o dia em São Paulo (fuso da operação).
 */
export type ClientDashboard = {
  total: number;
  active: number;
  delivered: number;
  nextDelivery: ClientOrder | null;
  attention: (ClientOrder & { daysLate: number })[];
  recent: ClientOrder[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`) -
      Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`)) /
      DAY_MS
  );
}

export function buildClientDashboard(
  orders: ClientOrder[],
  today: string = todayIso()
): ClientDashboard {
  const active = orders.filter((o) => o.bucket === "in_progress");
  const pending = active.filter((o) => o.etaBrazil && !o.deliveredOn);

  const upcoming = pending
    .filter((o) => o.etaBrazil!.slice(0, 10) >= today)
    .sort((a, b) => a.etaBrazil!.localeCompare(b.etaBrazil!));

  const attention = pending
    .filter((o) => o.etaBrazil!.slice(0, 10) < today)
    .map((o) => ({ ...o, daysLate: daysBetween(o.etaBrazil!, today) }))
    .sort((a, b) => b.daysLate - a.daysLate);

  return {
    total: orders.length,
    active: active.length,
    delivered: orders.filter((o) => o.bucket === "delivered").length,
    nextDelivery: upcoming[0] ?? null,
    attention,
    // A lista já vem do mais recente para o mais antigo (PO desc).
    recent: active.slice(0, 5),
  };
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
  /**
   * Produtos (categorias) que viajam neste lote — uma entrada por linha
   * Factory×Category, sem deduplicar (a mesma categoria pode repetir se vier
   * de mais de uma fábrica). Ordenados por nome.
   */
  products: ClientOrderProduct[];
};

export type ClientOrderProduct = {
  name: string;
  /** `order_factory_category.ship_requirement` — data em que a fábrica precisa entregar. */
  shipRequirement: string;
};

export type ClientOrderDetail = {
  id: string;
  po_number: string;
  client_reference: string | null;
  type: string | null;
  status: OrderStatus;
  /** Data pedida de embarque (orders.schedule_requested). */
  scheduleRequested: string | null;
  /**
   * ETA ao Brasil (passo `eta_brazil` do checklist do pedido). É estimativa
   * interna; expô-la ao cliente foi autorizado em 2026-08-26 (ver o cabeçalho
   * do arquivo). Por pedido, não por lote — o checklist é do pedido.
   */
  etaBrazil: string | null;
  /** Data de entrega efetiva (passo `delivered`/`ata_brazil`), quando houver. */
  deliveredOn: string | null;
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

  const [batches, ofc, categories, orderType, checklist] = await Promise.all([
    fetchAll<{ id: string; batch_number: string; status: BatchStatus }>((from, to) =>
      admin
        .from("batches")
        .select("id, batch_number, status")
        .eq("order_id", orderId)
        .range(from, to)
    ),
    fetchAll<{ batch_id: string | null; category_id: string; ship_requirement: string }>(
      (from, to) =>
        admin
          .from("order_factory_category")
          .select("batch_id, category_id, ship_requirement")
          .eq("is_active", true)
          .eq("order_id", orderId)
          .range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("categories").select("id, name").is("deleted_at", null).range(from, to)
    ),
    order.order_type_id
      ? admin.from("order_types").select("name").eq("id", order.order_type_id).single()
      : Promise.resolve({ data: null as { name: string } | null }),
    // Datas do checklist do pedido para ETA e entrega. Só os passos que
    // interessam ao cliente — não é a régua interna toda.
    fetchAll<{
      step: ChecklistStep;
      enabled: boolean;
      estimated_date: string | null;
      completed_on: string | null;
    }>((from, to) =>
      admin
        .from("order_checklist_steps")
        .select("step, enabled, estimated_date, completed_on")
        .eq("order_id", orderId)
        .in("step", ["eta_brazil", "ata_brazil", "delivered"])
        .range(from, to)
    ),
  ]);

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  // ETA = estimativa do passo eta_brazil; entrega = ata_brazil/delivered
  // efetivos (mesma regra da lista — `etaAndDelivery`).
  const { etaBrazil, deliveredOn } = etaAndDelivery(checklist);

  // lote → produtos, UMA linha por entrada Factory×Category (sem deduplicar):
  // é a mesma granularidade da tabela interna (docs §3.5.2), só sem a coluna
  // Factory, que segue interna à AGK. Ship req. entrou a pedido do Henrique
  // (2026-08-27) — é a mesma coluna que a tabela interna mostra.
  const byBatch = new Map<string, ClientOrderProduct[]>();
  const pending = new Set<string>();
  for (const row of ofc) {
    const name = categoryName.get(row.category_id)?.trim();
    if (!name) continue;
    if (!row.batch_id) {
      pending.add(name);
      continue;
    }
    const list = byBatch.get(row.batch_id) ?? [];
    list.push({ name, shipRequirement: row.ship_requirement });
    byBatch.set(row.batch_id, list);
  }

  const clientBatches: ClientOrderBatch[] = batches
    .map((b) => ({
      id: b.id,
      code: b.batch_number,
      status: b.status,
      label: BATCH_STATUS_LABELS[b.status],
      products: (byBatch.get(b.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  return {
    id: order.id,
    po_number: order.po_number,
    client_reference: order.client_reference,
    type: orderType.data?.name ?? null,
    status: order.status,
    scheduleRequested: order.schedule_requested,
    etaBrazil,
    deliveredOn,
    batches: clientBatches,
    pendingProducts: [...pending].sort((a, b) => a.localeCompare(b)),
  };
}
