import "server-only";

import { z } from "zod";

import type { createAdminClient } from "@/lib/supabase/admin";
import type { SessionProfile } from "@/lib/dal";
import { hasFeature, type FeatureKey } from "@/domain/access/features";
import type { BatchStatus, ChecklistStep, OrderStatus } from "@/types/database";
import { SHIPMENT_STEPS } from "@/lib/checklist";
import { daysDelay, gapOfReady } from "@/lib/etd";

/**
 * Ferramentas do copilot (docs/regras_de_negocio.md §6.1).
 *
 * As CHAVES deste registry são a allowlist: o modelo não escreve SQL e não
 * escolhe tabela — escolhe uma destas funções e preenche parâmetros validados
 * por Zod. É a mesma filosofia de `domain/api/registry.ts`, pelo mesmo motivo:
 * o que atravessa do modelo para o banco tem forma conhecida.
 *
 * Não existe lista fechada de perguntas. Cada ferramenta aceita os mesmos
 * filtros que a tela equivalente oferece, e o modelo os combina — o limite do
 * copilot é a superfície de dados aqui declarada, não um catálogo de frases.
 *
 * `feature` é a permissão exigida: a rota só oferece ao modelo as ferramentas
 * que o usuário logado pode ver, E revalida na execução (defesa em
 * profundidade — a lista enviada ao modelo não é uma fronteira de segurança).
 */

type AdminClient = ReturnType<typeof createAdminClient>;

export type ToolContext = {
  admin: AdminClient;
  session: SessionProfile;
  /** "Hoje" fixado no início da conversa: duas ferramentas na mesma resposta
   * não podem discordar sobre a data de referência do Gap of Ready. */
  todayMs: number;
};

export interface CopilotTool<I = unknown> {
  /** Feature exigida; `null` = qualquer usuário autenticado (só bibliotecas). */
  feature: FeatureKey | null;
  /** Vai para o modelo: diz o que faz E QUANDO chamar (o gatilho importa). */
  description: string;
  schema: z.ZodType<I>;
  run: (input: I, ctx: ToolContext) => Promise<unknown>;
}

function defineTool<I>(tool: CopilotTool<I>): CopilotTool {
  return tool as CopilotTool;
}

/** Teto de linhas por resposta — o modelo lê o resultado, não a tela. */
const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe("Max rows (default 20, cap 100).");

const DEFAULT_LIMIT = 20;

const ORDER_STATUSES: OrderStatus[] = [
  "in_negotiation",
  "in_production",
  "partially_preloading",
  "pre_loading",
  "partially_shipped",
  "shipped",
  "partially_delivered",
  "delivered",
  "canceled",
];

const BATCH_STATUSES: BatchStatus[] = [
  "in_negotiation",
  "in_production",
  "preloading",
  "in_transit",
  "delivered",
  "canceled",
];

/** Status terminais — mesma regra da To do list (§3.12.2). */
const TERMINAL_STATUS = new Set<string>(["delivered", "canceled"]);

const SHIPMENT_STEP_SET = new Set<ChecklistStep>(SHIPMENT_STEPS);

// ---------------------------------------------------------------------------
// Helpers de nome
// ---------------------------------------------------------------------------

type LibraryTable =
  | "clients"
  | "factories"
  | "categories"
  | "business_units"
  | "order_types"
  | "exporters"
  | "pods"
  | "pols"
  | "carriers"
  | "countries"
  | "agents"
  | "shipment_models";

/** id → name das bibliotecas, em uma query por tabela. */
async function nameMap(
  admin: AdminClient,
  table: LibraryTable,
  ids: (string | null | undefined)[]
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const { data } = await admin.from(table).select("id, name").in("id", unique);
  return new Map((data ?? []).map((row) => [row.id, row.name]));
}

/** id → nome da pessoa (profiles guarda `full_name`, não `name`). */
async function peopleMap(
  admin: AdminClient,
  ids: (string | null | undefined)[]
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const { data } = await admin.from("profiles").select("id, full_name").in("id", unique);
  return new Map((data ?? []).map((row) => [row.id, row.full_name ?? "—"]));
}

/** Data de hoje em ISO (YYYY-MM-DD) para comparar com colunas `date`. */
function todayIso(todayMs: number): string {
  return new Date(todayMs).toISOString().slice(0, 10);
}

/** Embed de relação 1:1 do PostgREST — o tipo gerado às vezes diz array. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

// ---------------------------------------------------------------------------
// Travessia Order → Lote → PL → Embarque
//
// A junção `pre_loading_batches` é o elo entre as duas metades do sistema. Sem
// percorrer isso cada ferramenta enxerga só o nível da sua tela, e perguntas
// que atravessam ("o PO 1437 está em quais PLs?") ficam sem resposta.
// ---------------------------------------------------------------------------

type PlRef = { id: string; pl_number: string };

type ShipmentRef = {
  id: string;
  container_number: string | null;
  status: string | null;
  estimated_date: string | null;
};

/** Onde cada lote está: os PLs que o contêm e o embarque de cada PL. */
async function locateBatches(
  admin: AdminClient,
  batchIds: string[]
): Promise<{ plsByBatch: Map<string, PlRef[]>; shipmentByPl: Map<string, ShipmentRef> }> {
  const plsByBatch = new Map<string, PlRef[]>();
  const shipmentByPl = new Map<string, ShipmentRef>();
  if (batchIds.length === 0) return { plsByBatch, shipmentByPl };

  const { data: links } = await admin
    .from("pre_loading_batches")
    .select("pre_loading_id, batch_id")
    .in("batch_id", batchIds);
  const rows = links ?? [];
  if (rows.length === 0) return { plsByBatch, shipmentByPl };

  const plIds = [...new Set(rows.map((r) => r.pre_loading_id))];
  const [plRes, shipRes] = await Promise.all([
    admin.from("pre_loadings").select("id, pl_number").in("id", plIds).is("deleted_at", null),
    admin
      .from("shipments")
      .select("id, pre_loading_id, container_number, status, estimated_date")
      .in("pre_loading_id", plIds)
      .is("deleted_at", null),
  ]);

  const plNumberById = new Map((plRes.data ?? []).map((p) => [p.id, p.pl_number]));
  for (const s of shipRes.data ?? []) {
    shipmentByPl.set(s.pre_loading_id, {
      id: s.id,
      container_number: s.container_number,
      status: s.status,
      estimated_date: s.estimated_date,
    });
  }
  for (const r of rows) {
    // PL apagado (soft delete) não entra: a tela também não o mostraria.
    const pl_number = plNumberById.get(r.pre_loading_id);
    if (!pl_number) continue;
    const arr = plsByBatch.get(r.batch_id) ?? [];
    arr.push({ id: r.pre_loading_id, pl_number });
    plsByBatch.set(r.batch_id, arr);
  }

  return { plsByBatch, shipmentByPl };
}

/**
 * Lotes-filhos gerados por split, mapeados para o lote de origem.
 *
 * No Confirm Shipping a entrada marcada Partial/None sai do lote que embarcou e
 * vai para um lote novo (docs §3.7.2) — o lote embarcado pode acabar sem
 * nenhuma linha própria. A tela do embarque resolve subindo a linhagem
 * (`app/(dashboard)/shipments/[id]/page.tsx`); aqui é a mesma conta, para o
 * copilot não responder "esse lote não tem fábrica" onde a tela mostra as
 * linhas. Profundidade limitada por segurança, caso algum dado forme ciclo.
 */
async function lineageOf(admin: AdminClient, batchIds: string[]): Promise<Map<string, string>> {
  const ancestorOf = new Map<string, string>();
  let frontier = batchIds;
  for (let depth = 0; depth < 10 && frontier.length > 0; depth++) {
    const { data } = await admin
      .from("batches")
      .select("id, split_from_batch_id")
      .in("split_from_batch_id", frontier);
    const generation = (data ?? []).filter((b) => !ancestorOf.has(b.id));
    if (generation.length === 0) break;
    for (const b of generation) {
      const parent = b.split_from_batch_id as string;
      ancestorOf.set(b.id, ancestorOf.get(parent) ?? parent);
    }
    frontier = generation.map((b) => b.id);
  }
  return ancestorOf;
}

/** PLs que contêm algum lote das orders cujo número casa com o texto. */
async function plIdsForPoNumber(admin: AdminClient, poNumber: string): Promise<string[]> {
  const { data: orders } = await admin
    .from("orders")
    .select("id")
    .ilike("po_number", `%${poNumber}%`)
    .is("deleted_at", null)
    .limit(200);
  const orderIds = (orders ?? []).map((o) => o.id);
  if (orderIds.length === 0) return [];

  const { data: batches } = await admin.from("batches").select("id").in("order_id", orderIds);
  const batchIds = (batches ?? []).map((b) => b.id);
  if (batchIds.length === 0) return [];

  const { data: links } = await admin
    .from("pre_loading_batches")
    .select("pre_loading_id")
    .in("batch_id", batchIds);
  return [...new Set((links ?? []).map((l) => l.pre_loading_id))];
}

/** Rótulo de lote como as telas mostram: número da order + sufixo (1437.02). */
function batchLabel(poNumber: string | null | undefined, batchNumber: string): string {
  return `${poNumber ?? ""}${batchNumber}`;
}

/** "1437, 1502" — as orders de cada PL, para a coluna de conteúdo. */
async function ordersByPreLoading(
  admin: AdminClient,
  plIds: string[]
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (plIds.length === 0) return out;

  const { data: links } = await admin
    .from("pre_loading_batches")
    .select("pre_loading_id, batch_id")
    .in("pre_loading_id", plIds);
  const rows = links ?? [];
  if (rows.length === 0) return out;

  const { data: batches } = await admin
    .from("batches")
    .select("id, order_id")
    .in("id", [...new Set(rows.map((r) => r.batch_id))]);
  const orderIdByBatch = new Map((batches ?? []).map((b) => [b.id, b.order_id]));

  const { data: orders } = await admin
    .from("orders")
    .select("id, po_number")
    .in("id", [...new Set((batches ?? []).map((b) => b.order_id))]);
  const poById = new Map((orders ?? []).map((o) => [o.id, o.po_number]));

  for (const r of rows) {
    const po = poById.get(orderIdByBatch.get(r.batch_id) ?? "");
    if (!po) continue;
    const arr = out.get(r.pre_loading_id) ?? [];
    if (!arr.includes(po)) arr.push(po);
    out.set(r.pre_loading_id, arr);
  }
  for (const [id, list] of out) out.set(id, list.sort());
  return out;
}

// ---------------------------------------------------------------------------
// resolve_entities
// ---------------------------------------------------------------------------

const RESOLVE_KINDS = {
  client: "clients",
  factory: "factories",
  category: "categories",
  business_unit: "business_units",
  order_type: "order_types",
  exporter: "exporters",
  pod: "pods",
  pol: "pols",
  carrier: "carriers",
  agent: "agents",
  shipment_model: "shipment_models",
} as const satisfies Record<string, LibraryTable>;

type ResolveKind = keyof typeof RESOLVE_KINDS;

const resolveEntities = defineTool({
  feature: null,
  description:
    "Translates a name the user typed into the id the other tools require. " +
    "Call this BEFORE filtering by client, factory, category, person, POD, POL, " +
    "carrier or business unit — never invent an id. Returns the candidates that " +
    "match the text; if more than one comes back, ask the user which one before " +
    "proceeding.",
  schema: z.object({
    kind: z
      .enum(["person", ...(Object.keys(RESOLVE_KINDS) as ResolveKind[])] as [string, ...string[]])
      .describe("Entity type to resolve. 'person' covers leader, requester and responsible."),
    query: z.string().min(1).describe("Part of the name, as the user typed it."),
    limit: limitSchema,
  }),
  run: async (input, { admin }) => {
    const limit = input.limit ?? 10;
    const pattern = `%${input.query}%`;

    if (input.kind === "person") {
      const { data } = await admin
        .from("profiles")
        .select("id, full_name, company")
        .ilike("full_name", pattern)
        .limit(limit);
      // `profiles` não guarda email (vive no auth.users); `company` (BR/China)
      // é o que resta para desambiguar homônimos sem um join custoso.
      return {
        matches: (data ?? []).map((p) => ({ id: p.id, name: p.full_name, company: p.company })),
      };
    }

    const table = RESOLVE_KINDS[input.kind as ResolveKind];
    const { data } = await admin
      .from(table)
      .select("id, name")
      .ilike("name", pattern)
      .limit(limit);
    return { matches: data ?? [] };
  },
});

// ---------------------------------------------------------------------------
// search_orders
// ---------------------------------------------------------------------------

type OrderRow = {
  id: string;
  po_number: string;
  status: OrderStatus;
  date_po: string | null;
  schedule_requested: string | null;
  client_reference: string | null;
  asap: boolean;
  client_id: string | null;
  business_unit_id: string | null;
  order_type_id: string | null;
  leader_id: string | null;
};

const searchOrders = defineTool({
  feature: "orders",
  description:
    "Lists orders with combinable filters. Call this for questions like " +
    "'which orders from client X are in production', 'what opened this month', " +
    "'partially shipped orders'. For the detail of ONE specific order " +
    "(batches, steps, ETD), use get_order_detail.",
  schema: z.object({
    po_number: z.string().optional().describe("Part of the order number (partial match)."),
    client_id: z.string().uuid().optional(),
    business_unit_id: z.string().uuid().optional(),
    order_type_id: z.string().uuid().optional(),
    leader_id: z.string().uuid().optional().describe("Leader responsible for the order."),
    status: z
      .array(z.enum(ORDER_STATUSES as [OrderStatus, ...OrderStatus[]]))
      .optional()
      .describe("One or more statuses. The enum order is the pipeline order."),
    date_po_from: z.string().optional().describe("Order date from (YYYY-MM-DD)."),
    date_po_to: z.string().optional().describe("Order date to (YYYY-MM-DD)."),
    limit: limitSchema,
  }),
  run: async (input, { admin }) => {
    const limit = input.limit ?? DEFAULT_LIMIT;
    let query = admin
      .from("orders")
      .select(
        "id, po_number, status, date_po, schedule_requested, client_reference, asap, client_id, business_unit_id, order_type_id, leader_id",
        { count: "exact" }
      )
      .is("deleted_at", null);

    if (input.po_number) query = query.ilike("po_number", `%${input.po_number}%`);
    if (input.client_id) query = query.eq("client_id", input.client_id);
    if (input.business_unit_id) query = query.eq("business_unit_id", input.business_unit_id);
    if (input.order_type_id) query = query.eq("order_type_id", input.order_type_id);
    if (input.leader_id) query = query.eq("leader_id", input.leader_id);
    if (input.status?.length) query = query.in("status", input.status);
    if (input.date_po_from) query = query.gte("date_po", input.date_po_from);
    if (input.date_po_to) query = query.lte("date_po", input.date_po_to);

    const { data, count, error } = await query
      .order("po_number", { ascending: false })
      .limit(limit)
      .returns<OrderRow[]>();
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const [clients, units, types, people] = await Promise.all([
      nameMap(admin, "clients", rows.map((r) => r.client_id)),
      nameMap(admin, "business_units", rows.map((r) => r.business_unit_id)),
      nameMap(admin, "order_types", rows.map((r) => r.order_type_id)),
      peopleMap(admin, rows.map((r) => r.leader_id)),
    ]);

    return {
      total_matched: count ?? rows.length,
      returned: rows.length,
      orders: rows.map((r) => ({
        // `id` fecha o link para /orders/[id] no painel; o prompt manda o modelo
        // não imprimi-lo na resposta (é dado de navegação, não de leitura).
        id: r.id,
        po_number: r.po_number,
        status: r.status,
        client: r.client_id ? (clients.get(r.client_id) ?? null) : null,
        client_reference: r.client_reference,
        business_unit: r.business_unit_id ? (units.get(r.business_unit_id) ?? null) : null,
        order_type: r.order_type_id ? (types.get(r.order_type_id) ?? null) : null,
        leader: r.leader_id ? (people.get(r.leader_id) ?? null) : null,
        date_po: r.date_po,
        schedule_requested: r.schedule_requested,
        asap: r.asap,
      })),
    };
  },
});

// ---------------------------------------------------------------------------
// get_order_detail
// ---------------------------------------------------------------------------

const getOrderDetail = defineTool({
  feature: "orders",
  description:
    "Full portrait of ONE order: header data, batches with status and where each " +
    "one is (PL and shipment), Factory×Category entries with ETD and the checklist " +
    "(what's missing and what's already done). Call this for 'summarize PO 4312', " +
    "'what's left for PO X to move forward' or 'which PLs is PO X in'. Accepts the " +
    "order number as the user typed it.",
  schema: z.object({
    po_number: z.string().min(1).describe("Order number, e.g. '4312' or 'PO - 4312'."),
  }),
  run: async (input, { admin, session, todayMs }) => {
    const { data: orders } = await admin
      .from("orders")
      .select(
        "id, po_number, status, date_po, schedule_requested, client_reference, asap, client_id, business_unit_id, order_type_id, leader_id, requester_id, exporter_id"
      )
      .ilike("po_number", `%${input.po_number}%`)
      .is("deleted_at", null)
      .limit(5);

    if (!orders?.length) return { found: false, reason: `No order matches "${input.po_number}".` };
    if (orders.length > 1) {
      return {
        found: false,
        reason: "More than one order matches this text — ask the user to choose.",
        candidates: orders.map((o) => o.po_number),
      };
    }

    const order = orders[0];
    const [batchesRes, ofcRes, stepsRes] = await Promise.all([
      admin.from("batches").select("batch_number, status, id").eq("order_id", order.id),
      admin
        .from("order_factory_category")
        .select(
          "id, factory_id, category_id, ship_requirement, loading_status, batch_id, etd_info(initial_date, current_date, ready, ready_date, inspection)"
        )
        .eq("order_id", order.id)
        .returns<
          {
            id: string;
            factory_id: string;
            category_id: string;
            ship_requirement: string | null;
            loading_status: string | null;
            batch_id: string | null;
            etd_info:
              | { initial_date: string | null; current_date: string | null; ready: boolean; ready_date: string | null; inspection: boolean }
              | { initial_date: string | null; current_date: string | null; ready: boolean; ready_date: string | null; inspection: boolean }[]
              | null;
          }[]
        >(),
      admin
        .from("order_checklist_steps")
        .select("step, enabled, estimated_date, completed_on, responsible_id")
        .eq("order_id", order.id),
    ]);

    const ofc = ofcRes.data ?? [];
    const steps = stepsRes.data ?? [];
    const batches = batchesRes.data ?? [];
    const batchNumberById = new Map(batches.map((b) => [b.id, b.batch_number]));

    const [clients, units, types, factories, categories, people] = await Promise.all([
      nameMap(admin, "clients", [order.client_id]),
      nameMap(admin, "business_units", [order.business_unit_id]),
      nameMap(admin, "order_types", [order.order_type_id]),
      nameMap(admin, "factories", ofc.map((r) => r.factory_id)),
      nameMap(admin, "categories", ofc.map((r) => r.category_id)),
      peopleMap(admin, [order.leader_id, order.requester_id, ...steps.map((s) => s.responsible_id)]),
    ]);

    const today = todayIso(todayMs);

    // Onde cada lote foi parar. Só para quem enxerga essas telas: o copilot não
    // pode virar a porta dos fundos para PL/embarque de quem não tem a feature.
    const seesPl = hasFeature(session.permissions, "pre_loading");
    const seesShipment = hasFeature(session.permissions, "shipments");
    const located =
      seesPl || seesShipment
        ? await locateBatches(admin, batches.map((b) => b.id))
        : { plsByBatch: new Map<string, PlRef[]>(), shipmentByPl: new Map<string, ShipmentRef>() };

    return {
      found: true,
      order: {
        po_number: order.po_number,
        status: order.status,
        client: order.client_id ? (clients.get(order.client_id) ?? null) : null,
        client_reference: order.client_reference,
        business_unit: order.business_unit_id ? (units.get(order.business_unit_id) ?? null) : null,
        order_type: order.order_type_id ? (types.get(order.order_type_id) ?? null) : null,
        leader: order.leader_id ? (people.get(order.leader_id) ?? null) : null,
        requester: order.requester_id ? (people.get(order.requester_id) ?? null) : null,
        date_po: order.date_po,
        schedule_requested: order.schedule_requested,
        asap: order.asap,
      },
      batches: batches.map((b) => {
        const pls = located.plsByBatch.get(b.id) ?? [];
        const shipment = pls.map((p) => located.shipmentByPl.get(p.id)).find(Boolean) ?? null;
        return {
          batch_number: b.batch_number,
          status: b.status,
          ...(seesPl || seesShipment
            ? { pre_loadings: pls.map((p) => p.pl_number) }
            : {}),
          ...(seesShipment
            ? {
                shipment: shipment
                  ? {
                      container_number: shipment.container_number,
                      status: shipment.status,
                      estimated_date: shipment.estimated_date,
                    }
                  : null,
              }
            : {}),
        };
      }),
      entries: ofc.map((row) => {
        const etd = Array.isArray(row.etd_info) ? row.etd_info[0] : row.etd_info;
        return {
          factory: factories.get(row.factory_id) ?? null,
          category: categories.get(row.category_id) ?? null,
          batch: row.batch_id ? (batchNumberById.get(row.batch_id) ?? null) : null,
          ship_requirement: row.ship_requirement,
          loading_status: row.loading_status,
          initial_date: etd?.initial_date ?? null,
          current_date: etd?.current_date ?? null,
          days_delay: daysDelay(etd?.initial_date ?? null, etd?.current_date ?? null),
          ready: etd?.ready ?? false,
          gap_of_ready: gapOfReady(etd?.ready, etd?.ready_date, todayMs),
        };
      }),
      checklist: {
        pending: steps
          .filter((s) => !s.completed_on && s.enabled !== false)
          .map((s) => ({
            step: s.step,
            estimated_date: s.estimated_date,
            overdue: Boolean(s.estimated_date && s.estimated_date < today),
            responsible: s.responsible_id ? (people.get(s.responsible_id) ?? null) : null,
          })),
        completed: steps
          .filter((s) => s.completed_on)
          .map((s) => ({ step: s.step, completed_on: s.completed_on })),
      },
    };
  },
});

// ---------------------------------------------------------------------------
// list_etd_entries
// ---------------------------------------------------------------------------

type EtdEmbed = {
  initial_date: string | null;
  current_date: string | null;
  ready: boolean;
  ready_date: string | null;
  inspection: boolean;
  updated_at: string;
};

type EtdQueryRow = {
  factory_id: string;
  category_id: string;
  ship_requirement: string | null;
  batches: { batch_number: string; status: BatchStatus } | null;
  orders: { id: string; po_number: string; client_id: string | null } | null;
  etd_info: EtdEmbed | EtdEmbed[] | null;
};

const listEtdEntries = defineTool({
  feature: "etd_factories",
  description:
    "Factory×Category entries with the ETD and the computed delay (Days Delay = " +
    "|current_date - initial_date|; late = greater than zero). Call this for " +
    "'which batches are late', 'delay for factory X', 'what's ready and hasn't " +
    "shipped'. By default it looks only at active batches (in_production and " +
    "preloading), like the ETD Factories screen.",
  schema: z.object({
    factory_id: z.string().uuid().optional(),
    category_id: z.string().uuid().optional(),
    client_id: z.string().uuid().optional(),
    po_number: z.string().optional().describe("Part of the order number."),
    batch_status: z
      .array(z.enum(BATCH_STATUSES as [BatchStatus, ...BatchStatus[]]))
      .optional()
      .describe("Default: in_production and preloading (the active batches)."),
    only_late: z
      .boolean()
      .optional()
      .describe("true = only entries with Days Delay > 0."),
    min_days_delay: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Minimum delay in days, e.g. 10 for 'more than 10 days'."),
    ready: z.boolean().optional().describe("Filters by the Ready parts checkbox."),
    limit: limitSchema,
  }),
  run: async (input, { admin, todayMs }) => {
    const limit = input.limit ?? DEFAULT_LIMIT;
    const statuses = input.batch_status?.length
      ? input.batch_status
      : (["in_production", "preloading"] as BatchStatus[]);

    let query = admin
      .from("order_factory_category")
      .select(
        "factory_id, category_id, ship_requirement, batches!inner(batch_number, status), orders!inner(id, po_number, client_id), etd_info(initial_date, current_date, ready, ready_date, inspection, updated_at)"
      )
      .in("batches.status", statuses)
      .is("orders.deleted_at", null);

    if (input.factory_id) query = query.eq("factory_id", input.factory_id);
    if (input.category_id) query = query.eq("category_id", input.category_id);
    if (input.client_id) query = query.eq("orders.client_id", input.client_id);
    if (input.po_number) query = query.ilike("orders.po_number", `%${input.po_number}%`);
    if (input.ready !== undefined) query = query.eq("etd_info.ready", input.ready);

    // Teto alto porque o corte real (atraso mínimo, ordenação por Days Delay) é
    // calculado aqui — a coluna não existe no banco, então não dá para ordenar
    // no PostgREST. O universo de lotes ativos é ~1.000 linhas.
    const { data, error } = await query.limit(2000).returns<EtdQueryRow[]>();
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const [factories, categories, clients] = await Promise.all([
      nameMap(admin, "factories", rows.map((r) => r.factory_id)),
      nameMap(admin, "categories", rows.map((r) => r.category_id)),
      nameMap(admin, "clients", rows.map((r) => r.orders?.client_id)),
    ]);

    const computed = rows.flatMap((row) => {
      const etd = Array.isArray(row.etd_info) ? row.etd_info[0] : row.etd_info;
      const delay = daysDelay(etd?.initial_date ?? null, etd?.current_date ?? null);
      if (input.only_late && !(delay !== null && delay > 0)) return [];
      if (input.min_days_delay !== undefined && (delay === null || delay < input.min_days_delay)) {
        return [];
      }
      return [
        {
          // order_id → link para /orders/[id] no painel (não vai na resposta).
          order_id: row.orders?.id ?? null,
          po_number: row.orders?.po_number ?? null,
          batch: row.batches?.batch_number ?? null,
          batch_status: row.batches?.status ?? null,
          client: row.orders?.client_id ? (clients.get(row.orders.client_id) ?? null) : null,
          factory: factories.get(row.factory_id) ?? null,
          category: categories.get(row.category_id) ?? null,
          ship_requirement: row.ship_requirement,
          initial_date: etd?.initial_date ?? null,
          current_date: etd?.current_date ?? null,
          days_delay: delay,
          ready: etd?.ready ?? false,
          gap_of_ready: gapOfReady(etd?.ready, etd?.ready_date, todayMs),
          inspection: etd?.inspection ?? false,
        },
      ];
    });

    computed.sort((a, b) => (b.days_delay ?? -1) - (a.days_delay ?? -1));

    return {
      total_matched: computed.length,
      returned: Math.min(limit, computed.length),
      entries: computed.slice(0, limit),
    };
  },
});

// ---------------------------------------------------------------------------
// list_pre_loadings
// ---------------------------------------------------------------------------

const listPreLoadings = defineTool({
  feature: "pre_loading",
  description:
    "Lists pre-load plans (PLs), exactly like the Pre-loading screen, and says " +
    "which orders each one carries. Call this for 'which PLs are open', 'who's the " +
    "leader of PL - 0231', 'which PLs carry PO 1437'. By default it shows the ones " +
    "still on that screen — a PL only drops off once its Loading Date step is " +
    "completed AND a shipment has been created for it.",
  schema: z.object({
    pl_number: z.string().optional().describe("Part of the PL number."),
    po_number: z
      .string()
      .optional()
      .describe("Only PLs that carry a batch of this order number."),
    leader_id: z.string().uuid().optional(),
    pod_id: z.string().uuid().optional(),
    include_confirmed: z
      .boolean()
      .optional()
      .describe("true = also include PLs that already left the screen (loading date completed + shipment created)."),
    limit: limitSchema,
  }),
  run: async (input, { admin, session }) => {
    const limit = input.limit ?? DEFAULT_LIMIT;

    // Filtro por order: a ligação lote↔PL mora em `pre_loading_batches`.
    let plIdsFromPo: string[] | null = null;
    if (input.po_number) {
      plIdsFromPo = await plIdsForPoNumber(admin, input.po_number);
      if (plIdsFromPo.length === 0) {
        return { total_matched: 0, returned: 0, pre_loadings: [] };
      }
    }

    // Mesma regra da tela Pre-loading (app/(dashboard)/pre-loading/page.tsx): o PL
    // só sai da lista quando a etapa Loading Date está concluída E já existe um
    // embarque atrelado. Isso cruza duas tabelas, então filtramos aqui, não no
    // PostgREST; o universo de PLs é pequeno (teto de 2000 basta).
    let query = admin
      .from("pre_loadings")
      .select(
        "id, pl_number, created_date, client_reference, booking_status, seal_number, pod_id, leader_id, responsible_signer_id"
      )
      .is("deleted_at", null);

    if (input.pl_number) query = query.ilike("pl_number", `%${input.pl_number}%`);
    if (plIdsFromPo) query = query.in("id", plIdsFromPo);
    if (input.leader_id) query = query.eq("leader_id", input.leader_id);
    if (input.pod_id) query = query.eq("pod_id", input.pod_id);

    const { data, error } = await query.limit(2000);
    if (error) throw new Error(error.message);

    const all = data ?? [];
    const ids = all.map((r) => r.id);

    const [stepsRes, shipRes] = await Promise.all([
      admin
        .from("pre_loading_checklist_steps")
        .select("pre_loading_id, completed_on")
        .eq("step", "loading_date")
        .in("pre_loading_id", ids),
      admin
        .from("shipments")
        .select("pre_loading_id")
        .is("deleted_at", null)
        .in("pre_loading_id", ids),
    ]);

    const loadingDoneBy = new Map<string, boolean>();
    for (const s of (stepsRes.data ?? []) as { pre_loading_id: string; completed_on: string | null }[]) {
      loadingDoneBy.set(s.pre_loading_id, Boolean(s.completed_on));
    }
    const shippedIds = new Set(
      ((shipRes.data ?? []) as { pre_loading_id: string }[]).map((s) => s.pre_loading_id)
    );

    const enriched = all.map((r) => {
      const loading_completed = loadingDoneBy.get(r.id) ?? false;
      const shipped = shippedIds.has(r.id);
      // "Aberto" = ainda na tela = NÃO (loading date concluída E embarcado).
      return { r, loading_completed, shipped, open: !(loading_completed && shipped) };
    });

    const filtered = (input.include_confirmed ? enriched : enriched.filter((e) => e.open)).sort(
      (a, b) => (Number(b.r.pl_number) || 0) - (Number(a.r.pl_number) || 0)
    );
    const pageRows = filtered.slice(0, limit);

    // O conteúdo do PL só vai para quem enxerga Orders.
    const seesOrders = hasFeature(session.permissions, "orders");
    const [pods, people, ordersByPl] = await Promise.all([
      nameMap(admin, "pods", pageRows.map((e) => e.r.pod_id)),
      peopleMap(admin, pageRows.flatMap((e) => [e.r.leader_id, e.r.responsible_signer_id])),
      seesOrders
        ? ordersByPreLoading(admin, pageRows.map((e) => e.r.id))
        : Promise.resolve(new Map<string, string[]>()),
    ]);

    return {
      total_matched: filtered.length,
      returned: pageRows.length,
      pre_loadings: pageRows.map(({ r, loading_completed, shipped }) => ({
        id: r.id,
        pl_number: r.pl_number,
        created_date: r.created_date,
        client_reference: r.client_reference,
        pod: r.pod_id ? (pods.get(r.pod_id) ?? null) : null,
        leader: r.leader_id ? (people.get(r.leader_id) ?? null) : null,
        booking_status: r.booking_status,
        seal_number: r.seal_number,
        loading_completed,
        shipped,
        ...(seesOrders ? { orders: (ordersByPl.get(r.id) ?? []).join(", ") || null } : {}),
      })),
    };
  },
});

// ---------------------------------------------------------------------------
// search_shipments
// ---------------------------------------------------------------------------

type ShipmentRow = {
  id: string;
  pre_loading_id: string;
  container_number: string | null;
  status: string | null;
  estimated_date: string | null;
  carrier_id: string | null;
  shipment_model_id: string | null;
  leader_id: string | null;
  pre_loadings: { pl_number: string } | { pl_number: string }[] | null;
};

const searchShipments = defineTool({
  feature: "shipments",
  description:
    "Lists shipments and which orders travel in each one. Call this for 'where is " +
    "container ABCD1234567', 'shipments in transit', 'what arrives by such date', " +
    "'which shipment carries PO 1437'. The container number accepts a partial match.",
  schema: z.object({
    container_number: z.string().optional().describe("Part of the container number."),
    pl_number: z.string().optional().describe("Part of the origin PL number."),
    po_number: z
      .string()
      .optional()
      .describe("Only shipments carrying a batch of this order number."),
    status: z
      .array(z.enum(["in_transit", "delivered", "canceled"]))
      .optional()
      .describe("Shipment status."),
    carrier_id: z.string().uuid().optional(),
    leader_id: z.string().uuid().optional(),
    estimated_from: z.string().optional().describe("Estimated date from (YYYY-MM-DD)."),
    estimated_to: z.string().optional().describe("Estimated date to (YYYY-MM-DD)."),
    limit: limitSchema,
  }),
  run: async (input, { admin, session }) => {
    const limit = input.limit ?? DEFAULT_LIMIT;

    // Filtro por order: chega-se ao embarque pelo PL que carrega o lote.
    let plIdsFromPo: string[] | null = null;
    if (input.po_number) {
      plIdsFromPo = await plIdsForPoNumber(admin, input.po_number);
      if (plIdsFromPo.length === 0) {
        return { total_matched: 0, returned: 0, shipments: [] };
      }
    }

    const joinType = input.pl_number ? "pre_loadings!inner" : "pre_loadings";
    let query = admin
      .from("shipments")
      .select(
        `id, pre_loading_id, container_number, status, estimated_date, carrier_id, shipment_model_id, leader_id, ${joinType}(pl_number)`,
        { count: "exact" }
      )
      .is("deleted_at", null);

    if (input.container_number) {
      query = query.ilike("container_number", `%${input.container_number}%`);
    }
    if (input.pl_number) query = query.ilike("pre_loadings.pl_number", `%${input.pl_number}%`);
    if (plIdsFromPo) query = query.in("pre_loading_id", plIdsFromPo);
    if (input.status?.length) query = query.in("status", input.status);
    if (input.carrier_id) query = query.eq("carrier_id", input.carrier_id);
    if (input.leader_id) query = query.eq("leader_id", input.leader_id);
    if (input.estimated_from) query = query.gte("estimated_date", input.estimated_from);
    if (input.estimated_to) query = query.lte("estimated_date", input.estimated_to);

    const { data, count, error } = await query
      .order("estimated_date", { ascending: true, nullsFirst: false })
      .limit(limit)
      .returns<ShipmentRow[]>();
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    // O conteúdo do embarque só vai para quem enxerga Orders.
    const seesOrders = hasFeature(session.permissions, "orders");
    const [carriers, models, people, ordersByPl] = await Promise.all([
      nameMap(admin, "carriers", rows.map((r) => r.carrier_id)),
      nameMap(admin, "shipment_models", rows.map((r) => r.shipment_model_id)),
      peopleMap(admin, rows.map((r) => r.leader_id)),
      seesOrders
        ? ordersByPreLoading(admin, rows.map((r) => r.pre_loading_id))
        : Promise.resolve(new Map<string, string[]>()),
    ]);

    return {
      total_matched: count ?? rows.length,
      returned: rows.length,
      shipments: rows.map((r) => {
        const pl = Array.isArray(r.pre_loadings) ? r.pre_loadings[0] : r.pre_loadings;
        return {
          id: r.id,
          pl_number: pl?.pl_number ?? null,
          ...(seesOrders
            ? { orders: (ordersByPl.get(r.pre_loading_id) ?? []).join(", ") || null }
            : {}),
          container_number: r.container_number,
          status: r.status,
          estimated_date: r.estimated_date,
          carrier: r.carrier_id ? (carriers.get(r.carrier_id) ?? null) : null,
          shipment_model: r.shipment_model_id ? (models.get(r.shipment_model_id) ?? null) : null,
          leader: r.leader_id ? (people.get(r.leader_id) ?? null) : null,
        };
      }),
    };
  },
});

// ---------------------------------------------------------------------------
// trace_chain
// ---------------------------------------------------------------------------

type ChainBatchRow = {
  id: string;
  batch_number: string;
  status: BatchStatus;
  orders:
    | { id: string; po_number: string; status: OrderStatus; client_id: string | null }
    | { id: string; po_number: string; status: OrderStatus; client_id: string | null }[]
    | null;
};

type ChainOfcRow = {
  batch_id: string | null;
  factory_id: string;
  category_id: string;
  ship_requirement: string | null;
  loading_status: string | null;
  etd_info:
    | { initial_date: string | null; current_date: string | null; ready: boolean; ready_date: string | null }
    | { initial_date: string | null; current_date: string | null; ready: boolean; ready_date: string | null }[]
    | null;
};

const traceChain = defineTool({
  feature: "orders",
  description:
    "Follows the chain Shipment ↔ PL ↔ batch ↔ Order ↔ Factory×Category starting " +
    "from ANY point of it. Call this whenever the question crosses levels: 'which " +
    "PLs is PO 1437 in', 'where are the batches of this order', 'what's inside PL " +
    "1394', 'which orders are in container ABCD1234567', 'factory status of batch " +
    "1437.02'. Give the point you know — order number, batch, PL number or " +
    "container — and it returns one row per batch with its PL, its shipment and " +
    "its Factory×Category entries.",
  schema: z
    .object({
      po_number: z.string().optional().describe("Order number, e.g. '1437'."),
      batch_number: z
        .string()
        .optional()
        .describe("Batch suffix inside the order, e.g. '.02'. Combine with po_number."),
      pl_number: z.string().optional().describe("PL number, e.g. '1394'."),
      container_number: z.string().optional().describe("Part of the container number."),
      limit: limitSchema,
    })
    .refine((v) => Boolean(v.po_number || v.pl_number || v.container_number), {
      message: "Give at least one of po_number, pl_number or container_number.",
    }),
  run: async (input, { admin, session, todayMs }) => {
    const limit = input.limit ?? DEFAULT_LIMIT;
    const seesPl = hasFeature(session.permissions, "pre_loading");
    const seesShipment = hasFeature(session.permissions, "shipments");

    // 1. Entrando pelo lado do embarque/PL: chega-se aos lotes pela junção.
    let batchIdFilter: string[] | null = null;
    if (input.pl_number || input.container_number) {
      if (!seesPl && !seesShipment) {
        return { found: false, reason: "You don't have access to pre-loadings or shipments." };
      }

      let fromShipments: string[] | null = null;
      if (input.container_number) {
        const { data: ships } = await admin
          .from("shipments")
          .select("pre_loading_id, container_number")
          .ilike("container_number", `%${input.container_number}%`)
          .is("deleted_at", null)
          .limit(200);
        const hits = ships ?? [];
        // Número cheio digitado casa com ele mesmo, não com quem o contém.
        const exact = hits.filter((s) => s.container_number === input.container_number);
        const chosen = exact.length > 0 ? exact : hits;
        fromShipments = [...new Set(chosen.map((s) => s.pre_loading_id))];
        if (fromShipments.length === 0) {
          return { found: false, reason: `No shipment matches container "${input.container_number}".` };
        }
      }

      const findPls = async (exact: boolean) => {
        let q = admin.from("pre_loadings").select("id").is("deleted_at", null);
        if (input.pl_number) {
          q = exact
            ? q.eq("pl_number", input.pl_number)
            : q.ilike("pl_number", `%${input.pl_number}%`);
        }
        if (fromShipments) q = q.in("id", fromShipments);
        const { data } = await q.limit(200);
        return (data ?? []).map((p) => p.id);
      };

      // "PL 149" é o PL 149, não os 11 que têm "149" no meio. Só cai no
      // parcial quando o exato não existe — aí o usuário digitou um pedaço.
      let plIds = input.pl_number ? await findPls(true) : [];
      if (plIds.length === 0) plIds = await findPls(false);
      if (plIds.length === 0) return { found: false, reason: "No PL matches that." };

      const { data: links } = await admin
        .from("pre_loading_batches")
        .select("batch_id")
        .in("pre_loading_id", plIds);
      batchIdFilter = [...new Set((links ?? []).map((l) => l.batch_id))];
      if (batchIdFilter.length === 0) {
        return { found: false, reason: "This PL has no batches attached to it." };
      }
    }

    // 2. Os lotes, com a order de cada um. Mesma regra do PL: "PO 1437" é a
    //    order 1437, e não as centenas que contêm "1437" como pedaço.
    const findBatches = async (exact: boolean) => {
      let q = admin
        .from("batches")
        .select("id, batch_number, status, orders!inner(id, po_number, status, client_id)")
        .is("orders.deleted_at", null);
      if (batchIdFilter) q = q.in("id", batchIdFilter);
      if (input.po_number) {
        q = exact
          ? q.eq("orders.po_number", input.po_number)
          : q.ilike("orders.po_number", `%${input.po_number}%`);
      }
      if (input.batch_number) q = q.ilike("batch_number", `%${input.batch_number}%`);
      const { data, error } = await q.limit(500).returns<ChainBatchRow[]>();
      if (error) throw new Error(error.message);
      return data ?? [];
    };

    let all = input.po_number ? await findBatches(true) : [];
    if (all.length === 0) all = await findBatches(false);
    if (all.length === 0) return { found: false, reason: "Nothing matches that." };

    const sorted = all.sort((a, b) => {
      const pa = one(a.orders)?.po_number ?? "";
      const pb = one(b.orders)?.po_number ?? "";
      return pa === pb ? a.batch_number.localeCompare(b.batch_number) : pb.localeCompare(pa);
    });
    const page = sorted.slice(0, limit);
    const pageIds = page.map((b) => b.id);

    // 3. Onde cada lote está + as linhas Factory×Category (seguindo a linhagem
    //    do split, senão um lote embarcado aparece sem nenhuma fábrica).
    const ancestorOf = await lineageOf(admin, pageIds);
    const [located, ofcRes] = await Promise.all([
      seesPl || seesShipment
        ? locateBatches(admin, pageIds)
        : Promise.resolve({
            plsByBatch: new Map<string, PlRef[]>(),
            shipmentByPl: new Map<string, ShipmentRef>(),
          }),
      admin
        .from("order_factory_category")
        .select(
          "batch_id, factory_id, category_id, ship_requirement, loading_status, etd_info(initial_date, current_date, ready, ready_date)"
        )
        .in("batch_id", [...pageIds, ...ancestorOf.keys()])
        .returns<ChainOfcRow[]>(),
    ]);

    const ofcRows = ofcRes.data ?? [];
    const [factories, categories, clients, batchNumbers] = await Promise.all([
      nameMap(admin, "factories", ofcRows.map((r) => r.factory_id)),
      nameMap(admin, "categories", ofcRows.map((r) => r.category_id)),
      nameMap(admin, "clients", page.map((b) => one(b.orders)?.client_id ?? null)),
      (async () => {
        const ids = [...ancestorOf.keys()];
        if (ids.length === 0) return new Map<string, string>();
        const { data: rows } = await admin.from("batches").select("id, batch_number").in("id", ids);
        return new Map((rows ?? []).map((r) => [r.id, r.batch_number]));
      })(),
    ]);

    const byBatch = new Map<string, ChainOfcRow[]>();
    for (const row of ofcRows) {
      if (!row.batch_id) continue;
      // Linha migrada no split conta para o lote de ORIGEM (o que embarcou).
      const target = ancestorOf.get(row.batch_id) ?? row.batch_id;
      const arr = byBatch.get(target) ?? [];
      arr.push(row);
      byBatch.set(target, arr);
    }

    const chain: Record<string, unknown>[] = [];
    const entries: Record<string, unknown>[] = [];

    for (const b of page) {
      const order = one(b.orders);
      const label = batchLabel(order?.po_number, b.batch_number);
      const pls = located.plsByBatch.get(b.id) ?? [];
      const shipment = pls.map((p) => located.shipmentByPl.get(p.id)).find(Boolean) ?? null;
      const rows = byBatch.get(b.id) ?? [];

      chain.push({
        order_id: order?.id ?? null,
        po_number: order?.po_number ?? null,
        batch: label,
        batch_status: b.status,
        client: order?.client_id ? (clients.get(order.client_id) ?? null) : null,
        ...(seesPl || seesShipment
          ? {
              pre_loading_id: pls[0]?.id ?? null,
              pl_number: pls.map((p) => p.pl_number).join(", ") || null,
            }
          : {}),
        ...(seesShipment
          ? {
              container_number: shipment?.container_number ?? null,
              shipment_status: shipment?.status ?? null,
              eta: shipment?.estimated_date ?? null,
            }
          : {}),
        factory_lines: rows.length,
      });

      for (const row of rows) {
        const etd = one(row.etd_info);
        const movedTo = row.batch_id && ancestorOf.has(row.batch_id) ? row.batch_id : null;
        entries.push({
          order_id: order?.id ?? null,
          po_number: order?.po_number ?? null,
          batch: label,
          factory: factories.get(row.factory_id) ?? null,
          category: categories.get(row.category_id) ?? null,
          ship_requirement: row.ship_requirement,
          loading_status: row.loading_status,
          initial_date: etd?.initial_date ?? null,
          current_date: etd?.current_date ?? null,
          days_delay: daysDelay(etd?.initial_date ?? null, etd?.current_date ?? null),
          ready: etd?.ready ?? false,
          gap_of_ready: gapOfReady(etd?.ready, etd?.ready_date, todayMs),
          // Preenchido só quando a linha saiu deste lote num split e hoje vive
          // em outro — o embarque continua sendo deste, a linha está lá.
          now_in_batch: movedTo
            ? batchLabel(order?.po_number, batchNumbers.get(movedTo) ?? "")
            : null,
        });
      }
    }

    return { found: true, total_matched: all.length, returned: page.length, chain, entries };
  },
});

// ---------------------------------------------------------------------------
// list_pending_steps
// ---------------------------------------------------------------------------

const listPendingSteps = defineTool({
  feature: "todo",
  description:
    "Checklist steps not yet completed, from Orders and from Pre-loading/Shipment. " +
    "Call this for 'what's pending for me', 'what's overdue', 'how many tasks does " +
    "so-and-so have'. Without responsible_id, it answers about the logged-in user. " +
    "A step is OVERDUE when its estimated date has passed and there's no completion.",
  schema: z.object({
    responsible_id: z
      .string()
      .uuid()
      .optional()
      .describe("Responsible person. Omit to use the logged-in user."),
    only_overdue: z.boolean().optional().describe("true = only steps whose estimated date is overdue."),
    phase: z
      .enum(["order", "preloading", "shipment"])
      .optional()
      .describe("Restricts to the checklist phase."),
    limit: limitSchema,
  }),
  run: async (input, { admin, session, todayMs }) => {
    const limit = input.limit ?? DEFAULT_LIMIT;
    const responsibleId = input.responsible_id ?? session.userId;
    const today = todayIso(todayMs);

    const [orderStepsRes, plStepsRes] = await Promise.all([
      input.phase === "preloading" || input.phase === "shipment"
        ? Promise.resolve({ data: [] })
        : admin
            .from("order_checklist_steps")
            .select("step, estimated_date, order_id")
            .eq("responsible_id", responsibleId)
            .is("completed_on", null)
            .limit(500),
      input.phase === "order"
        ? Promise.resolve({ data: [] })
        : admin
            .from("pre_loading_checklist_steps")
            .select("step, estimated_date, pre_loading_id")
            .eq("responsible_id", responsibleId)
            .is("completed_on", null)
            .limit(500),
    ]);

    const orderSteps = (orderStepsRes.data ?? []) as {
      step: ChecklistStep;
      estimated_date: string | null;
      order_id: string;
    }[];
    const plSteps = (plStepsRes.data ?? []) as {
      step: ChecklistStep;
      estimated_date: string | null;
      pre_loading_id: string;
    }[];

    // Registro em status terminal não tem tarefa real pendente — a esteira
    // encerrou e a pendência é resíduo da migração (§3.12.2).
    const { data: orders } = await admin
      .from("orders")
      .select("id, po_number, status, client_id")
      .in("id", [...new Set(orderSteps.map((s) => s.order_id))].slice(0, 500));
    const orderById = new Map((orders ?? []).map((o) => [o.id, o]));

    const plIds = [...new Set(plSteps.map((s) => s.pre_loading_id))].slice(0, 500);
    const [{ data: pls }, { data: shipments }] = await Promise.all([
      admin.from("pre_loadings").select("id, pl_number").in("id", plIds),
      admin.from("shipments").select("pre_loading_id, status").in("pre_loading_id", plIds),
    ]);
    const plById = new Map((pls ?? []).map((p) => [p.id, p.pl_number]));
    const shipmentStatusByPl = new Map(
      (shipments ?? []).map((s) => [s.pre_loading_id, s.status ?? ""])
    );

    const clients = await nameMap(
      admin,
      "clients",
      (orders ?? []).map((o) => o.client_id)
    );

    const rows = [
      ...orderSteps.flatMap((s) => {
        const order = orderById.get(s.order_id);
        if (!order || TERMINAL_STATUS.has(order.status)) return [];
        return [
          {
            phase: "order" as const,
            step: s.step,
            order_id: order.id as string | null,
            pre_loading_id: null as string | null,
            po_number: order.po_number,
            pl_number: null as string | null,
            client: order.client_id ? (clients.get(order.client_id) ?? null) : null,
            estimated_date: s.estimated_date,
            overdue: Boolean(s.estimated_date && s.estimated_date < today),
          },
        ];
      }),
      ...plSteps.flatMap((s) => {
        const isShipment = SHIPMENT_STEP_SET.has(s.step);
        if (isShipment) {
          const status = shipmentStatusByPl.get(s.pre_loading_id);
          if (status && TERMINAL_STATUS.has(status)) return [];
        }
        if (input.phase === "preloading" && isShipment) return [];
        if (input.phase === "shipment" && !isShipment) return [];
        return [
          {
            phase: isShipment ? ("shipment" as const) : ("preloading" as const),
            step: s.step,
            order_id: null as string | null,
            pre_loading_id: s.pre_loading_id as string | null,
            po_number: null as string | null,
            pl_number: plById.get(s.pre_loading_id) ?? null,
            client: null as string | null,
            estimated_date: s.estimated_date,
            overdue: Boolean(s.estimated_date && s.estimated_date < today),
          },
        ];
      }),
    ].filter((row) => !input.only_overdue || row.overdue);

    rows.sort((a, b) => (a.estimated_date ?? "9999").localeCompare(b.estimated_date ?? "9999"));

    return {
      responsible: responsibleId === session.userId ? "logged-in user" : responsibleId,
      total_matched: rows.length,
      overdue_count: rows.filter((r) => r.overdue).length,
      returned: Math.min(limit, rows.length),
      steps: rows.slice(0, limit),
    };
  },
});

// ---------------------------------------------------------------------------

export const COPILOT_TOOLS: Record<string, CopilotTool> = {
  resolve_entities: resolveEntities,
  search_orders: searchOrders,
  get_order_detail: getOrderDetail,
  list_etd_entries: listEtdEntries,
  list_pre_loadings: listPreLoadings,
  search_shipments: searchShipments,
  trace_chain: traceChain,
  list_pending_steps: listPendingSteps,
};

export type CopilotToolName = keyof typeof COPILOT_TOOLS;
