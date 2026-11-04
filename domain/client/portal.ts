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
 * banco não guarda (quantidade, descrição). Ver docs/regras_de_negocio.md.
 *
 * Datas de embarque e entrega (2026-11-04, bloco B do Portal v2): saem do
 * checklist do PRE-LOADING em que cada lote viaja (`pre_loading_checklist_steps`
 * — Shipping Date, ETA, Delivered), não do checklist da Order: desde a divisão
 * da esteira essas etapas só existem no PL (lib/checklist.ts, SHIPMENT_STEPS).
 * Antes o portal lia `order_checklist_steps.eta_brazil`, que nunca tem linha.
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
   * detalhe). Pedido entregue = 100; sem lote no fluxo, segue o status do pedido.
   */
  progressPct: number;
  /**
   * ETA ao Brasil do que AINDA não foi entregue: a maior ETA entre os PLs dos
   * lotes pendentes (o pedido só termina quando o último chega). Null quando
   * nenhum lote pendente tem PL com ETA.
   */
  etaBrazil: string | null;
  /** Entrega do pedido inteiro — só quando todos os lotes no fluxo foram entregues. */
  deliveredOn: string | null;
  /** Linhas de produto ativas (Factory×Category), sem deduplicar — igual ao detalhe. */
  itemCount: number;
  /** Categorias distintas do pedido, por nome. */
  categories: string[];
  /** Aba de "My orders": entregue, cancelado ou em andamento. */
  bucket: ClientOrderBucket;
};

export type ClientOrderBucket = "in_progress" | "delivered" | "canceled";

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

function progressPctOf(status: OrderStatus, batchStatuses: BatchStatus[]): number {
  if (status === "delivered") return 100;
  let sum = 0;
  let n = 0;
  for (const batchStatus of batchStatuses) {
    const weight = BATCH_PROGRESS[batchStatus];
    // Lote cancelado/em negociação está fora do ciclo — não puxa a média.
    if (weight === undefined) continue;
    sum += weight;
    n += 1;
  }
  return n === 0 ? ORDER_PROGRESS[status] ?? 0 : Math.round(sum / n);
}

/** Lote que conta para o acompanhamento (fora: negociação e cancelado). */
function inFlow(status: BatchStatus) {
  return BATCH_PROGRESS[status] !== undefined;
}

// ---------------------------------------------------------------------------
// Datas de embarque/entrega por lote, a partir do PL em que ele viaja
// ---------------------------------------------------------------------------

/** Datas de UM lote, tiradas do PL dele. "Actual" = fato; "expected" = previsão. */
export type BatchShipping = {
  /** Data de criação do PL — o lote entrou em Pre-Loading. */
  preLoadingOn: string | null;
  shippedOn: string | null;
  shipExpected: string | null;
  /** ETA ao Brasil do PL (data informada ou, no legado, a estimativa da etapa). */
  eta: string | null;
  deliveredOn: string | null;
};

const PL_STEPS: ChecklistStep[] = [
  "consolidation_point",
  "shipping_date",
  "eta_brazil",
  "ata_brazil",
  "delivered",
];

type PlStep = {
  pre_loading_id: string;
  step: ChecklistStep;
  done: boolean;
  estimated_date: string | null;
  completed_on: string | null;
  event_date: string | null;
};

/** Data do fato: `event_date` (desde 21/10) ou, no legado do Bubble, o `completed_on` de etapa feita. */
function actualOf(s: PlStep | undefined): string | null {
  if (!s) return null;
  return s.event_date ?? (s.done ? s.completed_on : null);
}

const minDate = (xs: (string | null | undefined)[]) =>
  xs.filter((x): x is string => !!x).sort()[0] ?? null;
const maxDate = (xs: (string | null | undefined)[]) =>
  xs.filter((x): x is string => !!x).sort().at(-1) ?? null;

const IN_CHUNK = 100;

function chunks<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * lote → datas do PL em que ele viaja, para os lotes deste cliente (opcionalmente
 * só de um pedido). O escopo vem do join `batches!inner(orders!inner(client_id))`
 * — o mesmo cuidado das outras leituras: o filtro do dono vai na query, não no
 * código depois. Lote em mais de um PL (raro) fica com o PL mais recente.
 */
async function loadBatchShipping(
  admin: ReturnType<typeof createAdminClient>,
  clientId: string,
  orderId?: string
): Promise<Map<string, BatchShipping>> {
  const links = await fetchAll<{ pre_loading_id: string; batch_id: string }>((from, to) => {
    let q = admin
      .from("pre_loading_batches")
      .select("pre_loading_id, batch_id, batches!inner(order_id, orders!inner(client_id))")
      .eq("batches.orders.client_id", clientId);
    if (orderId) q = q.eq("batches.order_id", orderId);
    return q.range(from, to).returns<{ pre_loading_id: string; batch_id: string }[]>();
  });

  const plIds = [...new Set(links.map((l) => l.pre_loading_id))];
  if (plIds.length === 0) return new Map();

  const [pls, steps, clientDelivered] = await Promise.all([
    Promise.all(
      chunks(plIds).map((ids) =>
        fetchAll<{ id: string; created_date: string }>((from, to) =>
          admin
            .from("pre_loadings")
            .select("id, created_date")
            .in("id", ids)
            .is("deleted_at", null)
            .range(from, to)
        )
      )
    ).then((r) => r.flat()),
    Promise.all(
      chunks(plIds).map((ids) =>
        fetchAll<PlStep>((from, to) =>
          admin
            .from("pre_loading_checklist_steps")
            .select("pre_loading_id, step, done, estimated_date, completed_on, event_date")
            .in("pre_loading_id", ids)
            .in("step", PL_STEPS)
            .range(from, to)
        )
      )
    ).then((r) => r.flat()),
    // PL com vários clientes: a entrega de CADA cliente tem data própria
    // (`pre_loading_client_delivered`) e vale antes da etapa geral.
    fetchAll<{ pre_loading_id: string; delivered_date: string }>((from, to) =>
      admin
        .from("pre_loading_client_delivered")
        .select("pre_loading_id, delivered_date")
        .eq("client_id", clientId)
        .range(from, to)
    ),
  ]);

  const plCreated = new Map(pls.map((p) => [p.id, p.created_date]));
  const stepsByPl = new Map<string, Map<ChecklistStep, PlStep>>();
  for (const s of steps) {
    const m = stepsByPl.get(s.pre_loading_id) ?? new Map<ChecklistStep, PlStep>();
    m.set(s.step, s);
    stepsByPl.set(s.pre_loading_id, m);
  }
  const deliveredForClient = new Map(
    clientDelivered.map((d) => [d.pre_loading_id, d.delivered_date])
  );

  // PL apagado some (não está em `plCreated`). Entre vários PLs, o mais recente.
  const plOfBatch = new Map<string, string>();
  for (const l of links) {
    const created = plCreated.get(l.pre_loading_id);
    if (!created) continue;
    const prev = plOfBatch.get(l.batch_id);
    if (!prev || (plCreated.get(prev) ?? "") < created) plOfBatch.set(l.batch_id, l.pre_loading_id);
  }

  const out = new Map<string, BatchShipping>();
  for (const [batchId, plId] of plOfBatch) {
    const st = stepsByPl.get(plId) ?? new Map<ChecklistStep, PlStep>();
    const ship = st.get("shipping_date");
    const eta = st.get("eta_brazil");
    const shippedOn = actualOf(ship);
    out.set(batchId, {
      // Entrada em Pre-Loading: a criação do PL ou, se veio antes, a chegada ao
      // Consolidation Point (1ª etapa do PL). No legado do Bubble o
      // `created_date` do PL é o dia da migração, e só a etapa tem a data real.
      preLoadingOn: minDate([plCreated.get(plId), actualOf(st.get("consolidation_point"))]),
      shippedOn,
      shipExpected: shippedOn ? null : ship?.estimated_date ?? null,
      eta: eta?.event_date ?? eta?.estimated_date ?? actualOf(eta),
      deliveredOn:
        deliveredForClient.get(plId) ?? actualOf(st.get("delivered")) ?? null,
    });
  }
  return out;
}

/** Datas do pedido somando os lotes no fluxo. */
type OrderShipping = {
  preLoadingOn: string | null;
  shippedOn: string | null;
  shipExpected: string | null;
  etaBrazil: string | null;
  firstDeliveredOn: string | null;
  deliveredOn: string | null;
};

function orderShippingOf(
  batches: { id: string; status: BatchStatus }[],
  shipping: Map<string, BatchShipping>
): OrderShipping {
  const flow = batches.filter((b) => inFlow(b.status));
  const dates = flow.map((b) => shipping.get(b.id));
  const notDelivered = flow.filter((b) => !shipping.get(b.id)?.deliveredOn && b.status !== "delivered");
  const allDelivered = flow.length > 0 && notDelivered.length === 0;
  return {
    preLoadingOn: minDate(dates.map((d) => d?.preLoadingOn)),
    shippedOn: minDate(dates.map((d) => d?.shippedOn)),
    shipExpected: minDate(notDelivered.map((b) => shipping.get(b.id)?.shipExpected)),
    etaBrazil: maxDate(notDelivered.map((b) => shipping.get(b.id)?.eta)),
    firstDeliveredOn: minDate(dates.map((d) => d?.deliveredOn)),
    deliveredOn: allDelivered ? maxDate(dates.map((d) => d?.deliveredOn)) : null,
  };
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

  const [orders, batches, types, ofc, categories, shipping] = await Promise.all([
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
    fetchAll<{ id: string; order_id: string; batch_number: string; status: BatchStatus }>(
      (from, to) =>
        admin
          .from("batches")
          .select("id, order_id, batch_number, status, orders!inner(client_id)")
          .eq("orders.client_id", clientId)
          .range(from, to)
          .returns<{ id: string; order_id: string; batch_number: string; status: BatchStatus }[]>()
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("order_types").select("id, name").is("deleted_at", null).range(from, to)
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
    loadBatchShipping(admin, clientId),
  ]);

  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name.trim()]));

  // order → { linhas de produto, categorias distintas }.
  const itemsByOrder = new Map<string, { count: number; categories: Set<string> }>();
  for (const row of ofc) {
    const entry = itemsByOrder.get(row.order_id) ?? { count: 0, categories: new Set<string>() };
    entry.count += 1;
    const name = categoryName.get(row.category_id);
    if (name) entry.categories.add(name);
    itemsByOrder.set(row.order_id, entry);
  }

  const batchesByOrder = new Map<string, typeof batches>();
  for (const b of batches) {
    const list = batchesByOrder.get(b.order_id) ?? [];
    list.push(b);
    batchesByOrder.set(b.order_id, list);
  }

  const rows: ClientOrder[] = orders.map((o) => {
    const own = batchesByOrder.get(o.id) ?? [];
    const counts = new Map<BatchStatus, number>();
    for (const b of own) counts.set(b.status, (counts.get(b.status) ?? 0) + 1);
    const ship = orderShippingOf(own, shipping);
    return {
      id: o.id,
      po_number: o.po_number,
      client_reference: o.client_reference,
      type: o.order_type_id ? typeName.get(o.order_type_id) ?? null : null,
      status: o.status,
      scheduleRequested: o.schedule_requested,
      batchNumbers: own
        .map((b) => b.batch_number)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      progress: [...counts]
        .map(([status, count]) => ({ label: BATCH_STATUS_LABELS[status], count }))
        .sort((a, b) => b.count - a.count),
      progressPct: progressPctOf(
        o.status,
        own.map((b) => b.status)
      ),
      etaBrazil: o.status === "delivered" ? null : ship.etaBrazil,
      deliveredOn: ship.deliveredOn,
      itemCount: itemsByOrder.get(o.id)?.count ?? 0,
      categories: [...(itemsByOrder.get(o.id)?.categories ?? [])].sort((a, b) =>
        a.localeCompare(b)
      ),
      bucket: bucketOf(o.status),
    };
  });

  // Mais recente primeiro, no mesmo critério da lista interna: o PO number é
  // sequencial, então ordenar por ele numericamente é ordenar por recência.
  rows.sort((a, b) => (Number(b.po_number) || 0) - (Number(a.po_number) || 0));

  return rows;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

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

/** Dias de atraso: ETA já passou e o pedido não foi entregue. Null = no prazo / sem ETA. */
export function daysLateOf(
  o: { bucket: ClientOrderBucket; etaBrazil: string | null; deliveredOn: string | null },
  today: string = todayIso()
): number | null {
  if (o.bucket !== "in_progress" || !o.etaBrazil || o.deliveredOn) return null;
  const days = daysBetween(o.etaBrazil, today);
  return days > 0 ? days : null;
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
    .map((o) => ({ ...o, daysLate: daysLateOf(o, today) ?? 0 }))
    .filter((o) => o.daysLate > 0)
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

// ---------------------------------------------------------------------------
// Detalhe do pedido
// ---------------------------------------------------------------------------

/**
 * Detalhe de UM pedido para o portal — linha do tempo do pedido, os LOTES e
 * quais produtos (categorias) viajam em cada um.
 *
 * Recorte (revisto 2026-08-26): o número do lote aparece. Segue de fora o que é
 * interno da AGK (fábrica, exporter, ETD) e o que o banco não guarda
 * (quantidade, descrição de produto). O produto continua na granularidade de
 * CATEGORIA, que é o que o `order_factory_category` fixa.
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
  /** ETA ao Brasil do PL do lote (null = ainda sem PL/ETA). */
  eta: string | null;
  /** Entrega do lote (do PL; por cliente quando o PL tem vários). */
  deliveredOn: string | null;
};

export type ClientOrderProduct = {
  name: string;
  /** `order_factory_category.ship_requirement` — data em que a fábrica precisa entregar. */
  shipRequirement: string;
};

export type TimelineStageKey = "in_production" | "pre_loading" | "in_transit" | "delivered";

export type TimelineStage = {
  key: TimelineStageKey;
  label: string;
  state: "done" | "current" | "upcoming";
  /** Data real (quando aconteceu) ou prevista (estágio futuro). */
  date: string | null;
  dateKind: "actual" | "expected" | null;
};

export type ClientOrderDetail = {
  id: string;
  po_number: string;
  client_reference: string | null;
  type: string | null;
  status: OrderStatus;
  /** Data pedida de embarque (orders.schedule_requested). */
  scheduleRequested: string | null;
  /** ETA ao Brasil do que falta entregar (ver `ClientOrder.etaBrazil`). */
  etaBrazil: string | null;
  /** Entrega do pedido inteiro, quando todos os lotes chegaram. */
  deliveredOn: string | null;
  /** Dias de atraso sobre a ETA (null = no prazo, sem ETA ou entregue). */
  daysLate: number | null;
  progressPct: number;
  /** Frase curta de onde a carga está, pelo estágio atual do pedido. */
  currentLocation: string;
  timeline: TimelineStage[];
  /** Lotes do pedido, ordenados pelo número. */
  batches: ClientOrderBatch[];
  /** Produtos do pedido ainda sem lote — não começaram a viajar. */
  pendingProducts: string[];
};

/** Estágio atual da linha do tempo pelo status do pedido (-1 = cancelado). */
const ORDER_STAGE: Record<OrderStatus, number> = {
  in_negotiation: -1,
  in_production: 0,
  pre_loading: 1,
  partially_shipped: 2,
  shipped: 2,
  partially_delivered: 3,
  delivered: 3,
  canceled: -1,
};

const CURRENT_LOCATION: Record<OrderStatus, string> = {
  in_negotiation: "Under negotiation",
  in_production: "In production at the factory in China",
  pre_loading: "Being prepared for shipment in China",
  partially_shipped: "Partially shipped — part of the order is on the way to Brazil",
  shipped: "In transit — on the way to Brazil",
  partially_delivered: "Partially delivered in Brazil",
  delivered: "Delivered in Brazil",
  canceled: "Order canceled",
};

function buildTimeline(
  status: OrderStatus,
  productionOn: string | null,
  ship: OrderShipping
): TimelineStage[] {
  const current = ORDER_STAGE[status];
  const stages: { key: TimelineStageKey; label: string; actual: string | null; expected: string | null }[] = [
    { key: "in_production", label: "In Production", actual: productionOn, expected: null },
    { key: "pre_loading", label: "Pre-Loading", actual: ship.preLoadingOn, expected: null },
    { key: "in_transit", label: "In Transit", actual: ship.shippedOn, expected: ship.shipExpected },
    {
      key: "delivered",
      label: "Delivered",
      actual: ship.deliveredOn ?? ship.firstDeliveredOn,
      expected: ship.etaBrazil,
    },
  ];
  return stages.map((s, i) => {
    const state: TimelineStage["state"] =
      current < 0
        ? "upcoming"
        : i < current || (i === current && status === "delivered")
          ? "done"
          : i === current
            ? "current"
            : "upcoming";
    // Concluído mostra a data do fato; futuro, a previsão; o atual mostra quando
    // começou e, se isso não estiver registrado, a previsão de quando termina.
    if (state === "done") {
      return { key: s.key, label: s.label, state, date: s.actual, dateKind: s.actual ? "actual" : null };
    }
    if (state === "current" && s.actual) {
      return { key: s.key, label: s.label, state, date: s.actual, dateKind: "actual" };
    }
    return { key: s.key, label: s.label, state, date: s.expected, dateKind: s.expected ? "expected" : null };
  });
}

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

  const [batches, ofc, categories, orderType, orderSteps, shipping] = await Promise.all([
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
    // Início da produção: o pedido entra em produção no Deposit Payment (regra
    // do GSS); sem ele, o Place the Order.
    fetchAll<{ step: ChecklistStep; enabled: boolean; completed_on: string | null }>(
      (from, to) =>
        admin
          .from("order_checklist_steps")
          .select("step, enabled, completed_on")
          .eq("order_id", orderId)
          .in("step", ["deposit_payment", "place_the_order"])
          .range(from, to)
    ),
    loadBatchShipping(admin, clientId, orderId),
  ]);

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  const stepDone = (step: ChecklistStep) =>
    orderSteps.find((s) => s.step === step && s.enabled !== false)?.completed_on ?? null;
  const productionOn = stepDone("deposit_payment") ?? stepDone("place_the_order");

  const ship = orderShippingOf(batches, shipping);
  const etaBrazil = order.status === "delivered" ? null : ship.etaBrazil;
  const bucket = bucketOf(order.status);

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
      eta: shipping.get(b.id)?.eta ?? null,
      deliveredOn: shipping.get(b.id)?.deliveredOn ?? null,
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
    deliveredOn: ship.deliveredOn,
    daysLate: daysLateOf({ bucket, etaBrazil, deliveredOn: ship.deliveredOn }),
    progressPct: progressPctOf(
      order.status,
      batches.map((b) => b.status)
    ),
    currentLocation: CURRENT_LOCATION[order.status],
    timeline: buildTimeline(order.status, productionOn, { ...ship, etaBrazil }),
    batches: clientBatches,
    pendingProducts: [...pending].sort((a, b) => a.localeCompare(b)),
  };
}
