import "server-only";

import { z } from "zod";

import type { createAdminClient } from "@/lib/supabase/admin";
import type {
  ChecklistStep,
  LoadingStatus,
  OrderStatus,
} from "@/types/database";
import { ORDER_STEPS } from "@/lib/checklist";

/**
 * Leitura GSS → SOTWISE de ORDERS (o pull do lado do GSS).
 *
 * Espelha o payload da via inbound (`domain/orders/gss-schema.ts`) e acrescenta
 * o que só o SOTWISE sabe: o `status` da order, as linhas Factory×Category com
 * o lote que o usuário atribuiu e o checklist da fase Order. As bibliotecas
 * saem com o `gss_id` ao lado do nome — assim o GSS reconcilia pela MESMA chave
 * que usa para escrever, sem precisar conhecer os UUIDs internos.
 *
 * Leader/Requester saem como `{ id, name }`: o e-mail (que o POST aceita) mora
 * em `auth.users`, schema que o PostgREST não expõe, e devolvê-lo exigiria uma
 * nova função SECURITY DEFINER — fica para quando o GSS precisar casar por
 * e-mail (hoje ele casa pelo `gss_id` da order).
 */

type AdminClient = ReturnType<typeof createAdminClient>;

type UUID = string;
type DateStr = string;
type Timestamp = string;

/** Valores de `orders.status` — a lista em runtime que o tipo não dá. */
const ORDER_STATUSES = [
  "in_negotiation",
  "in_production",
  "partially_preloading",
  "pre_loading",
  "partially_shipped",
  "shipped",
  "partially_delivered",
  "delivered",
  "canceled",
] as const satisfies readonly OrderStatus[];

/** Blocos opcionais do GET — cada um custa queries a mais. */
const INCLUDES = ["items", "checklist"] as const;
type Include = (typeof INCLUDES)[number];

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

/**
 * Query string do `GET /api/gss/orders`. Tudo opcional: sem filtro nenhum a
 * resposta é a página mais recente. `updated_since` é o gancho de sincronização
 * incremental do GSS (combina com `order=asc` para varrer em ordem cronológica).
 */
export const gssOrderQuerySchema = z.object({
  gss_id: z.string().trim().min(1).optional(),
  po_number: z.string().trim().min(1).optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  updated_since: z.iso.datetime({ offset: true }).optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
  include: z
    .string()
    .trim()
    .optional()
    .transform((raw) =>
      raw
        ? raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : []
    )
    .pipe(z.array(z.enum(INCLUDES))),
});

export type GssOrderQuery = z.infer<typeof gssOrderQuerySchema>;

const QUERY_KEYS = [
  "gss_id",
  "po_number",
  "status",
  "updated_since",
  "order",
  "limit",
  "offset",
  "include",
] as const;

/** Só as chaves conhecidas viram query — o resto da query string é ignorado. */
export function parseGssOrderQuery(params: URLSearchParams) {
  const raw: Record<string, string> = {};
  for (const key of QUERY_KEYS) {
    const value = params.get(key);
    if (value !== null && value !== "") raw[key] = value;
  }
  return gssOrderQuerySchema.safeParse(raw);
}

/** Biblioteca referenciada pela order, na chave que o GSS entende. */
type LibraryRef = { id: UUID; gss_id: string | null; name: string };
type PersonRef = { id: UUID; name: string | null };

type OrderRow = {
  id: UUID;
  gss_id: string | null;
  po_number: string;
  status: OrderStatus;
  asap: boolean;
  schedule_requested: DateStr | null;
  client_reference: string | null;
  date_po: DateStr | null;
  order_type_id: UUID | null;
  client_id: UUID | null;
  business_unit_id: UUID | null;
  exporter_id: UUID | null;
  leader_id: UUID | null;
  requester_id: UUID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

const ORDER_COLUMNS =
  "id, gss_id, po_number, status, asap, schedule_requested, client_reference, date_po, " +
  "order_type_id, client_id, business_unit_id, exporter_id, leader_id, requester_id, " +
  "created_at, updated_at";

export type GssOrderReadItem = {
  id: UUID;
  factory: LibraryRef | null;
  category: LibraryRef | null;
  ship_requirement: DateStr;
  loading_status: LoadingStatus | null;
  batch: { id: UUID; batch_number: string; status: string } | null;
};

export type GssOrderReadStep = {
  step: ChecklistStep;
  enabled: boolean;
  done: boolean;
  estimated_date: DateStr | null;
  completed_on: DateStr | null;
};

export type GssOrderRead = {
  id: UUID;
  gss_id: string | null;
  po_number: string;
  status: OrderStatus;
  asap: boolean;
  schedule_requested: DateStr | null;
  client_reference: string | null;
  date_po: DateStr | null;
  order_type: LibraryRef | null;
  client: LibraryRef | null;
  business_unit: LibraryRef | null;
  exporter: LibraryRef | null;
  leader: PersonRef | null;
  requester: PersonRef | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  items?: GssOrderReadItem[];
  checklist?: GssOrderReadStep[];
};

/** Tabelas de biblioteca que o GET traduz de UUID para `{gss_id, name}`. */
type LibTable =
  | "order_types"
  | "clients"
  | "business_units"
  | "exporters"
  | "factories"
  | "categories";

/** Busca `{id → {gss_id, name}}` só dos ids realmente usados na página. */
async function libraryMap(
  admin: AdminClient,
  table: LibTable,
  ids: UUID[]
): Promise<Map<UUID, LibraryRef>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await admin
    .from(table)
    .select("id, name, gss_id")
    .in("id", ids)
    .returns<LibraryRef[]>();
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row) => [row.id, row]));
}

/** Idem para os usuários do SOTWISE (profiles não têm gss_id — só o nome). */
async function profileMap(admin: AdminClient, ids: UUID[]): Promise<Map<UUID, PersonRef>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await admin
    .from("profiles")
    .select("id, full_name")
    .in("id", ids)
    .returns<{ id: UUID; full_name: string | null }[]>();
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row) => [row.id, { id: row.id, name: row.full_name }]));
}

/** Ids distintos e não-nulos de uma coluna FK da página de orders. */
function idsOf(rows: OrderRow[], key: keyof OrderRow): UUID[] {
  const set = new Set<UUID>();
  for (const row of rows) {
    const value = row[key];
    if (typeof value === "string") set.add(value);
  }
  return [...set];
}

/** Linhas Factory×Category das orders da página, já com fábrica/categoria/lote. */
async function loadItems(
  admin: AdminClient,
  orderIds: UUID[]
): Promise<Map<UUID, GssOrderReadItem[]>> {
  const byOrder = new Map<UUID, GssOrderReadItem[]>();
  if (orderIds.length === 0) return byOrder;

  type OfcRow = {
    id: UUID;
    order_id: UUID;
    factory_id: UUID;
    category_id: UUID;
    batch_id: UUID | null;
    ship_requirement: DateStr;
    loading_status: LoadingStatus | null;
  };
  const { data, error } = await admin
    .from("order_factory_category")
    .select("id, order_id, factory_id, category_id, batch_id, ship_requirement, loading_status")
    .in("order_id", orderIds)
    .returns<OfcRow[]>();
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.length === 0) return byOrder;

  const batchIds = [...new Set(rows.map((r) => r.batch_id).filter((id): id is UUID => !!id))];
  const [factories, categories, batches] = await Promise.all([
    libraryMap(admin, "factories", [...new Set(rows.map((r) => r.factory_id))]),
    libraryMap(admin, "categories", [...new Set(rows.map((r) => r.category_id))]),
    loadBatches(admin, batchIds),
  ]);
  const batchMap = new Map(batches.map((b) => [b.id, b]));

  for (const row of rows) {
    const list = byOrder.get(row.order_id) ?? [];
    list.push({
      id: row.id,
      factory: factories.get(row.factory_id) ?? null,
      category: categories.get(row.category_id) ?? null,
      ship_requirement: row.ship_requirement,
      loading_status: row.loading_status,
      batch: row.batch_id ? batchMap.get(row.batch_id) ?? null : null,
    });
    byOrder.set(row.order_id, list);
  }
  return byOrder;
}

/** Lotes citados pelas linhas Factory×Category (o lote é atribuído no SOTWISE). */
async function loadBatches(
  admin: AdminClient,
  ids: UUID[]
): Promise<{ id: UUID; batch_number: string; status: string }[]> {
  if (ids.length === 0) return [];
  const { data, error } = await admin
    .from("batches")
    .select("id, batch_number, status")
    .in("id", ids)
    .returns<{ id: UUID; batch_number: string; status: string }[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Checklist da fase Order (10 etapas), na ordem canônica das telas. */
async function loadChecklist(
  admin: AdminClient,
  orderIds: UUID[]
): Promise<Map<UUID, GssOrderReadStep[]>> {
  const byOrder = new Map<UUID, GssOrderReadStep[]>();
  if (orderIds.length === 0) return byOrder;

  type StepRow = GssOrderReadStep & { order_id: UUID };
  const { data, error } = await admin
    .from("order_checklist_steps")
    .select("order_id, step, enabled, done, estimated_date, completed_on")
    .in("order_id", orderIds)
    .returns<StepRow[]>();
  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const list = byOrder.get(row.order_id) ?? [];
    list.push({
      step: row.step,
      enabled: row.enabled,
      done: row.done,
      estimated_date: row.estimated_date,
      completed_on: row.completed_on,
    });
    byOrder.set(row.order_id, list);
  }
  const rank = new Map(ORDER_STEPS.map((step, i) => [step, i]));
  for (const list of byOrder.values()) {
    list.sort((a, b) => (rank.get(a.step) ?? 99) - (rank.get(b.step) ?? 99));
  }
  return byOrder;
}

/**
 * Uma página de orders no formato do GSS. `total` é a contagem do filtro (sem
 * paginação), para o GSS saber quantas páginas ainda faltam.
 */
export async function listGssOrders(
  admin: AdminClient,
  query: GssOrderQuery
): Promise<{ data: GssOrderRead[]; total: number }> {
  let select = admin
    .from("orders")
    .select(ORDER_COLUMNS, { count: "exact" })
    .is("deleted_at", null);

  if (query.gss_id) select = select.eq("gss_id", query.gss_id);
  if (query.po_number) select = select.eq("po_number", query.po_number);
  if (query.status) select = select.eq("status", query.status);
  if (query.updated_since) select = select.gte("updated_at", query.updated_since);

  const { data, error, count } = await select
    // `id` desempata: sem ele, orders com o mesmo updated_at podiam pular ou
    // repetir entre páginas.
    .order("updated_at", { ascending: query.order === "asc" })
    .order("id", { ascending: true })
    .range(query.offset, query.offset + query.limit - 1)
    .returns<OrderRow[]>();
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const orderIds = rows.map((r) => r.id);
  const wants = (block: Include) => query.include.includes(block);

  const [orderTypes, clients, businessUnits, exporters, people, items, checklist] =
    await Promise.all([
      libraryMap(admin, "order_types", idsOf(rows, "order_type_id")),
      libraryMap(admin, "clients", idsOf(rows, "client_id")),
      libraryMap(admin, "business_units", idsOf(rows, "business_unit_id")),
      libraryMap(admin, "exporters", idsOf(rows, "exporter_id")),
      profileMap(admin, [...idsOf(rows, "leader_id"), ...idsOf(rows, "requester_id")]),
      wants("items")
        ? loadItems(admin, orderIds)
        : Promise.resolve(new Map<UUID, GssOrderReadItem[]>()),
      wants("checklist")
        ? loadChecklist(admin, orderIds)
        : Promise.resolve(new Map<UUID, GssOrderReadStep[]>()),
    ]);

  const out: GssOrderRead[] = rows.map((row) => {
    const order: GssOrderRead = {
      id: row.id,
      gss_id: row.gss_id,
      po_number: row.po_number,
      status: row.status,
      asap: row.asap,
      schedule_requested: row.schedule_requested,
      client_reference: row.client_reference,
      date_po: row.date_po,
      order_type: row.order_type_id ? orderTypes.get(row.order_type_id) ?? null : null,
      client: row.client_id ? clients.get(row.client_id) ?? null : null,
      business_unit: row.business_unit_id
        ? businessUnits.get(row.business_unit_id) ?? null
        : null,
      exporter: row.exporter_id ? exporters.get(row.exporter_id) ?? null : null,
      leader: row.leader_id ? people.get(row.leader_id) ?? null : null,
      requester: row.requester_id ? people.get(row.requester_id) ?? null : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
    if (wants("items")) order.items = items.get(row.id) ?? [];
    if (wants("checklist")) order.checklist = checklist.get(row.id) ?? [];
    return order;
  });

  return { data: out, total: count ?? out.length };
}
