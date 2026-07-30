/**
 * Importador Bubble (LIVE) → Supabase. Idempotente (upsert por bubble_id).
 * Camada 1: usuários/profiles + cadastros. (Transacional/checklist: próxima camada.)
 * Uso: npm run migrate
 */
import { supabaseAdmin } from "./client";
import { fetchAll } from "./bubble";
import {
  upsertByBubbleId, upsertJunction, loadIdMap, tableCount,
  str, reqStr, bool, ref, dateOnly, tsz,
} from "./upsert";

type Row = Record<string, any>;

function mapCompany(v: unknown): "BR" | "China" {
  const s = str(v);
  if (!s) return "BR";
  if (/chin/i.test(s)) return "China";
  return "BR";
}

/** email guardado em user.authentication (Bubble): { email: { email: "..." } }. */
function userEmail(u: Row): string | null {
  const a = u.authentication as any;
  return str(a?.email?.email) ?? str(a?.email) ?? str(u.email);
}

async function preloadAuthUsers() {
  const byEmail = new Map<string, string>();
  const byBubble = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    for (const u of data.users) {
      if (u.email) byEmail.set(u.email.toLowerCase(), u.id);
      const bid = (u.user_metadata as any)?.bubble_id;
      if (bid) byBubble.set(String(bid), u.id);
    }
    if (data.users.length < 1000) break;
  }
  return { byEmail, byBubble };
}

async function importUsers() {
  const rows = await fetchAll("user");
  // pega o role 'user' por nome
  const { data: roleRows } = await supabaseAdmin.from("roles").select("id, name");
  const userRoleId = (roleRows ?? []).find((r: any) => r.name === "user")?.id as string;
  if (!userRoleId) throw new Error("role 'user' não encontrado (rode o seed de roles)");

  const existingProfiles = await loadIdMap("profiles");
  const auth = await preloadAuthUsers();

  const profiles: Row[] = [];
  for (const u of rows) {
    const bubbleId = u._id as string;
    const email = userEmail(u);
    let authId = existingProfiles.get(bubbleId) || auth.byBubble.get(bubbleId) || (email ? auth.byEmail.get(email.toLowerCase()) : undefined);

    if (!authId) {
      const createEmail = email ?? `bubble-${bubbleId}@import.local`;
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: createEmail,
        email_confirm: true,
        user_metadata: { bubble_id: bubbleId, full_name: str(u.Name) },
      });
      if (error) {
        const found = email ? auth.byEmail.get(email.toLowerCase()) : undefined;
        if (!found) { console.warn(`  ! user ${bubbleId} (${createEmail}): ${error.message}`); continue; }
        authId = found;
      } else {
        authId = data.user!.id;
        if (data.user!.email) auth.byEmail.set(data.user!.email.toLowerCase(), authId);
      }
    }

    profiles.push({
      id: authId,
      full_name: reqStr(u.Name),
      role_id: userRoleId,
      company: mapCompany(u.company),
      hidden: bool(u.hidden),
      status: u.IsDisabled === true ? "blocked" : "active",
      bubble_id: bubbleId,
    });
  }
  const n = await upsertByBubbleId("profiles", profiles);
  return { fetched: rows.length, upserted: n };
}

async function importCadastros() {
  const users = await loadIdMap("profiles"); // p/ created_by
  const cb = (r: Row) => ref(users, r["Created By"]);
  const results: Record<string, { fetched: number; upserted: number }> = {};
  const mark = (t: string, fetched: number, upserted: number) => (results[t] = { fetched, upserted });

  // countries: Bubble não tem esse type -> derivar dos nomes em agents.Country
  const agentsRaw = await fetchAll("agents");
  const countryNames = new Set<string>();
  for (const a of agentsRaw) { const c = str(a.Country); if (c) countryNames.add(c); }
  const countryRows = [...countryNames].map((name) => ({ name, bubble_id: `country:${name}` }));
  mark("countries", countryRows.length, await upsertByBubbleId("countries", countryRows));
  const countriesById = await loadIdMap("countries");
  const countryByName = new Map<string, string>();
  for (const [bid, id] of countriesById) if (bid.startsWith("country:")) countryByName.set(bid.slice(8), id);

  // factories / categories
  const factoriesRaw = await fetchAll("factory");
  mark("factories", factoriesRaw.length, await upsertByBubbleId("factories",
    factoriesRaw.map((f) => ({ name: reqStr(f.factory), bubble_id: f._id, created_by: cb(f) }))));
  const categoriesRaw = await fetchAll("category");
  mark("categories", categoriesRaw.length, await upsertByBubbleId("categories",
    categoriesRaw.map((c) => ({ name: reqStr(c.category), bubble_id: c._id, created_by: cb(c) }))));

  const factMap = await loadIdMap("factories");
  const catMap = await loadIdMap("categories");
  // category_factories: usa category.factories (array de factory ids)
  const cf: Row[] = [];
  for (const c of categoriesRaw) {
    const cid = catMap.get(c._id); if (!cid) continue;
    for (const fid of (Array.isArray(c.factories) ? c.factories : [])) {
      const f = factMap.get(fid as string); if (f) cf.push({ category_id: cid, factory_id: f });
    }
  }
  mark("category_factories", cf.length, await upsertJunction("category_factories", cf, "category_id,factory_id"));

  // cities / pols / pods
  const citiesRaw = await fetchAll("cities");
  mark("cities", citiesRaw.length, await upsertByBubbleId("cities",
    citiesRaw.map((c) => ({ name: reqStr(c.City), bubble_id: c._id }))));
  const polsRaw = await fetchAll("pol");
  mark("pols", polsRaw.length, await upsertByBubbleId("pols",
    polsRaw.map((p) => ({ name: reqStr(p.POL), bubble_id: p._id }))));
  const podsRaw = await fetchAll("pod");
  mark("pods", podsRaw.length, await upsertByBubbleId("pods",
    podsRaw.map((p) => ({ name: reqStr(p.POD), bubble_id: p._id }))));

  const cityMap = await loadIdMap("cities");
  const polMap = await loadIdMap("pols");
  // city_pols: usa pol.City
  const cp: Row[] = [];
  for (const p of polsRaw) {
    const pid = polMap.get(p._id); const city = ref(cityMap, p.City);
    if (pid && city) cp.push({ city_id: city, pol_id: pid });
  }
  mark("city_pols", cp.length, await upsertJunction("city_pols", cp, "city_id,pol_id"));

  // contacts
  const contactsRaw = await fetchAll("contacts");
  mark("contacts", contactsRaw.length, await upsertByBubbleId("contacts",
    contactsRaw.map((c) => ({
      name: reqStr(c.Contact), email: str(c.Email), email_na: false,
      phone_number: reqStr(c.Phone), bubble_id: c._id, created_by: cb(c),
    }))));

  // agents (usa countryByName)
  mark("agents", agentsRaw.length, await upsertByBubbleId("agents",
    agentsRaw.map((a) => ({
      name: reqStr(a.Agent), country_id: countryByName.get(str(a.Country) ?? "") ?? null,
      location: null, email: str(a["E-mail"]), email_na: false, phone_number: str(a.Phone),
      bubble_id: a._id, created_by: cb(a),
    }))));

  const agentMap = await loadIdMap("agents");
  const contactMap = await loadIdMap("contacts");
  // agent_contacts: usa contacts.Agent
  const ac: Row[] = [];
  for (const c of contactsRaw) {
    const contactId = contactMap.get(c._id); const agentId = ref(agentMap, c.Agent);
    if (contactId && agentId) ac.push({ agent_id: agentId, contact_id: contactId });
  }
  mark("agent_contacts", ac.length, await upsertJunction("agent_contacts", ac, "agent_id,contact_id"));

  // carriers
  const carriersRaw = await fetchAll("carrier");
  mark("carriers", carriersRaw.length, await upsertByBubbleId("carriers",
    carriersRaw.map((c) => ({ name: reqStr(c.carrier_name), bubble_id: c._id, created_by: cb(c) }))));

  // clients (Country do Bubble é id-ref para type inexistente -> null)
  const clientsRaw = await fetchAll("clients");
  mark("clients", clientsRaw.length, await upsertByBubbleId("clients",
    clientsRaw.map((c) => ({ name: reqStr(c.ClientID), country_id: null, bubble_id: c._id, created_by: cb(c) }))));

  // exporters
  const exportersRaw = await fetchAll("exporters");
  mark("exporters", exportersRaw.length, await upsertByBubbleId("exporters",
    exportersRaw.map((e) => ({ name: reqStr(e.Exporter), acronym: reqStr(e.Acronym), bubble_id: e._id, created_by: cb(e) }))));

  // business_units
  const buRaw = await fetchAll("businessunit");
  mark("business_units", buRaw.length, await upsertByBubbleId("business_units",
    buRaw.map((b) => ({ name: reqStr(b.BusinessUnit) || reqStr(b.label), icon_path: str(b.IconReference), bubble_id: b._id, created_by: cb(b) }))));

  // order_types
  const otRaw = await fetchAll("ordertype");
  mark("order_types", otRaw.length, await upsertByBubbleId("order_types",
    otRaw.map((o) => ({ name: reqStr(o.label) || reqStr(o.OrderTypeDesc), icon_path: str(o.IconReference), color: null, bubble_id: o._id, created_by: cb(o) }))));

  // shipment_models
  const smRaw = await fetchAll("shipmentmodel");
  mark("shipment_models", smRaw.length, await upsertByBubbleId("shipment_models",
    smRaw.map((s) => ({ name: reqStr(s.ShipmentModel), bubble_id: s._id, created_by: cb(s) }))));

  return results;
}

// ---- mapeamento de status (labels do Bubble → enums) ----
const norm = (v: unknown) => (str(v) || "").toLowerCase();
function orderStatus(label: unknown): string {
  const s = norm(label);
  if (s.includes("negotiation")) return "in_negotiation";
  if (s.includes("transit")) return "shipped";
  if (s.includes("deliver")) return "delivered";
  if (s.includes("pre-load") || s.includes("preload")) return "in_production";
  if (s.includes("production")) return "in_production";
  if (s.includes("stand")) return "in_negotiation";
  if (s.includes("cancel") || s.includes("duplicate")) return "canceled";
  return "in_negotiation";
}
function batchStatus(label: unknown): string {
  const s = norm(label);
  if (s.includes("transit")) return "in_transit";
  if (s.includes("deliver")) return "delivered";
  if (s.includes("pre-load") || s.includes("preload")) return "preloading";
  if (s.includes("production")) return "in_production";
  if (s.includes("cancel") || s.includes("duplicate")) return "canceled";
  return "in_negotiation";
}

/**
 * Status materializado da Order. Lotes cancelados não participam do rollup;
 * `preloading` continua sendo uma fase de produção para a Order.
 */
function rollupOrderStatus(statuses: string[], currentStatus: string): string {
  // O cancelamento da Order é uma decisão explícita e não pode ser deduzido
  // apenas pelos lotes, que são devolvidos a uma fase anterior antes de cancelar.
  if (currentStatus === "canceled") return "canceled";

  const active = statuses.filter((status) => status !== "canceled");
  if (active.length === 0) return currentStatus;
  if (active.every((status) => status === "delivered")) return "delivered";

  const hasTransit = active.includes("in_transit");
  const hasDelivered = active.includes("delivered");
  const hasProduction = active.some(
    (status) => status === "in_production" || status === "preloading"
  );

  if (hasTransit && hasDelivered) return "partially_delivered";
  if (active.every((status) => status === "in_transit")) return "shipped";
  if (hasTransit && hasProduction) return "partially_shipped";
  if (active.every((status) => status === "in_production" || status === "preloading")) {
    return "in_production";
  }
  return "in_negotiation";
}

/** Recalcula o rollup das Orders após importar/atualizar os lotes. */
async function refreshOrderStatusesFromBatches() {
  const statusesByOrder = new Map<string, string[]>();
  const currentStatusByOrder = new Map<string, string>();
  const PAGE = 1000;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("batches")
      .select("order_id, status")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load batches for order rollup: ${error.message}`);
    for (const batch of data ?? []) {
      const statuses = statusesByOrder.get(batch.order_id) ?? [];
      statuses.push(batch.status);
      statusesByOrder.set(batch.order_id, statuses);
    }
    if (!data || data.length < PAGE) break;
  }

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("id, status")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load orders for status rollup: ${error.message}`);
    for (const order of data ?? []) currentStatusByOrder.set(order.id, order.status);
    if (!data || data.length < PAGE) break;
  }

  const changes = [...statusesByOrder.entries()]
    .map(([id, statuses]) => ({
      id,
      status: rollupOrderStatus(statuses, currentStatusByOrder.get(id) ?? "in_negotiation"),
    }))
    .filter((order) => currentStatusByOrder.get(order.id) !== order.status);

  const WRITE_BATCH = 25;
  for (let i = 0; i < changes.length; i += WRITE_BATCH) {
    const writes = changes.slice(i, i + WRITE_BATCH).map(async (order) => {
      const { error } = await supabaseAdmin
        .from("orders")
        .update({ status: order.status })
        .eq("id", order.id);
      if (error) throw new Error(`roll up order ${order.id}: ${error.message}`);
    });
    await Promise.all(writes);
  }

  return { fetched: statusesByOrder.size, upserted: changes.length };
}

/**
 * Backfill pontual de `orders.created_at` a partir de "Data criação" do Bubble
 * (campo custom do usuário — "Created Date" nativo foi resetado numa
 * reimportação e não reflete a data real). Só toca essa coluna via
 * `.update()` — NÃO usa upsert, pra não sobrescrever status/outros campos
 * que já possam ter divergido do Bubble desde a migração inicial.
 */
async function backfillOrderCreatedAt() {
  const ordersRaw = await fetchAll("[vistapub]order");
  const orderMap = await loadIdMap("orders");

  const updates = ordersRaw
    .map((o) => {
      const id = orderMap.get(o._id);
      const createdAt = tsz(o["Data criação"]) ?? tsz(o["Created Date"]);
      if (!id || !createdAt) return null;
      return { id, created_at: createdAt };
    })
    .filter(Boolean) as { id: string; created_at: string }[];

  const WRITE_BATCH = 25;
  for (let i = 0; i < updates.length; i += WRITE_BATCH) {
    const writes = updates.slice(i, i + WRITE_BATCH).map(async (u) => {
      const { error } = await supabaseAdmin
        .from("orders")
        .update({ created_at: u.created_at })
        .eq("id", u.id);
      if (error) throw new Error(`backfill created_at order ${u.id}: ${error.message}`);
    });
    await Promise.all(writes);
  }

  return { fetched: ordersRaw.length, upserted: updates.length };
}

/**
 * Backfill pontual de `orders.leader_id` / `requester_id` / `exporter_id`.
 * O Bubble adicionou campos dedicados "Leader Order", "Requester" e
 * "Exporter" na order — só orders criadas/editadas recentemente têm eles
 * preenchidos. Pra orders antigas, "Order Resp" continua sendo a melhor
 * aproximação de Leader/Requester (ver comentário em
 * importTransactionalCore). Exporter não tem fallback — fica null mesmo
 * pra orders antigas, igual ao Bubble. Só toca essas 3 colunas via
 * `.update()`, mesmo cuidado do backfillOrderCreatedAt.
 */
async function backfillOrderPeople() {
  const ordersRaw = await fetchAll("[vistapub]order");
  const orderMap = await loadIdMap("orders");
  const userMap = await loadIdMap("profiles");
  const exporterMap = await loadIdMap("exporters");

  const updates = ordersRaw
    .map((o) => {
      const id = orderMap.get(o._id);
      if (!id) return null;
      const leader_id = ref(userMap, o["Leader Order"]) ?? ref(userMap, o["Order Resp"]);
      const requester_id = ref(userMap, o["Requester"]) ?? ref(userMap, o["Order Resp"]);
      const exporter_id = ref(exporterMap, o["Exporter"]);
      if (!leader_id && !requester_id && !exporter_id) return null;
      return { id, leader_id, requester_id, exporter_id };
    })
    .filter(Boolean) as {
    id: string;
    leader_id: string | null;
    requester_id: string | null;
    exporter_id: string | null;
  }[];

  const WRITE_BATCH = 25;
  for (let i = 0; i < updates.length; i += WRITE_BATCH) {
    const writes = updates.slice(i, i + WRITE_BATCH).map(async (u) => {
      const patch: Row = {};
      if (u.leader_id) patch.leader_id = u.leader_id;
      if (u.requester_id) patch.requester_id = u.requester_id;
      if (u.exporter_id) patch.exporter_id = u.exporter_id;
      const { error } = await supabaseAdmin.from("orders").update(patch).eq("id", u.id);
      if (error) throw new Error(`backfill leader/requester/exporter order ${u.id}: ${error.message}`);
    });
    await Promise.all(writes);
  }

  return { fetched: ordersRaw.length, upserted: updates.length };
}

function loadingStatus(label: unknown): string | null {
  const s = norm(label);
  if (s === "total") return "total";
  if (s === "partial") return "partial";
  if (s === "none") return "none";
  return null;
}
/** Descarta datas-lixo (epoch/1970) vindas do Bubble. */
function safeDate(v: unknown): string | null {
  const d = dateOnly(v);
  return d && d >= "2000-01-01" ? d : null;
}

async function importTransactionalCore() {
  const results: Record<string, { fetched: number; upserted: number; skipped?: number }> = {};
  const orderTypeMap = await loadIdMap("order_types");
  const clientMap = await loadIdMap("clients");
  const buMap = await loadIdMap("business_units");
  const userMap = await loadIdMap("profiles");
  const catMap = await loadIdMap("categories");
  const factMap = await loadIdMap("factories");
  const exporterMap = await loadIdMap("exporters");

  // ORDERS
  const ordersRaw = await fetchAll("[vistapub]order");
  const orderRows = ordersRaw.map((o) => ({
    po_number: reqStr(o["Number PO text"]) || String(o["Number PO"] ?? o._id),
    order_type_id: ref(orderTypeMap, o["Order Type"]),
    schedule_requested: dateOnly(o["Schedule Requested"]),
    asap: bool(o["ASAP?"]),
    client_id: ref(clientMap, o["Clients"]),
    client_reference: str(o["Cliente Reference"]),
    business_unit_id: ref(buMap, o["Business Unit"]),
    // O Bubble adicionou campos dedicados "Leader Order" / "Requester" /
    // "Exporter" na order — só orders recentes têm eles preenchidos. Em
    // orders antigas, caem no fallback "Order Resp", que era o único campo
    // disponível antes disso existir (confirmado comparando a PO 1510: sem
    // "Leader Order"/"Requester", "Order Resp" resolvia pro Leader real).
    requester_id: ref(userMap, o["Requester"]) ?? ref(userMap, o["Order Resp"]),
    leader_id: ref(userMap, o["Leader Order"]) ?? ref(userMap, o["Order Resp"]),
    exporter_id: ref(exporterMap, o["Exporter"]),
    status: orderStatus(o["Status Order OS [Vistapub]"]),
    date_po: dateOnly(o["Date PO"]),
    // "Data criação" é um campo custom que o usuário criou pra preservar a
    // data real de criação — "Created Date" (built-in do Bubble) foi resetado
    // numa reimportação de dados e não reflete a data original.
    created_at: tsz(o["Data criação"]) ?? tsz(o["Created Date"]) ?? undefined,
    created_by: ref(userMap, o["Created By"]),
    bubble_id: o._id,
  }));
  results.orders = { fetched: ordersRaw.length, upserted: await upsertByBubbleId("orders", orderRows) };
  const orderMap = await loadIdMap("orders");

  // BATCHES — da lista ORDENADA "Lista de Lotes x Orders" de cada order → .01/.02...
  // A lista da OS define a numeração; o registro do lote traz seu status próprio.
  // O fallback preserva lotes antigos sem o campo exposto no Bubble.
  const batchesRaw = await fetchAll("[vistapub]orderxlotexpl");
  const batchByBubbleId = new Map(batchesRaw.map((b) => [b._id, b]));
  const batchRows: Row[] = [];
  const seen = new Set<string>();
  for (const o of ordersRaw) {
    const orderId = orderMap.get(o._id);
    const lotes = Array.isArray(o["Lista de Lotes x Orders"]) ? o["Lista de Lotes x Orders"] : [];
    lotes.forEach((bid: string, i: number) => {
      if (!orderId || typeof bid !== "string" || seen.has(bid)) return;
      seen.add(bid);
      batchRows.push({
        order_id: orderId,
        batch_number: "." + String(i + 1).padStart(2, "0"),
        status: batchStatus(
          batchByBubbleId.get(bid)?.["Status Batch OS"] ?? o["Status Order OS [Vistapub]"]
        ),
        bubble_id: bid,
      });
    });
  }
  results.batches = { fetched: batchRows.length, upserted: await upsertByBubbleId("batches", batchRows) };
  results.orders_status_rollup = await refreshOrderStatusesFromBatches();
  const batchMap = await loadIdMap("batches");

  // ORDER_FACTORY_CATEGORY
  const ofcRaw = await fetchAll("[vistapub]listoffactoriesxcategoriesxlote");
  let ofcSkip = 0;
  const ofcRows = ofcRaw
    .map((f) => {
      const order_id = ref(orderMap, f["Order"]);
      const category_id = ref(catMap, f["Category"]);
      const factory_id = ref(factMap, f["Factories"]);
      if (!order_id || !category_id || !factory_id) { ofcSkip++; return null; }
      return {
        order_id, category_id, factory_id,
        batch_id: ref(batchMap, f["Lote x Order x PL"]),
        ship_requirement: safeDate(f["Shipment Requirement"]),
        loading_status: loadingStatus(f["[Vistapub] Status List of Categories x Factories"]),
        bubble_id: f._id,
      };
    })
    .filter(Boolean) as Row[];
  results.order_factory_category = { fetched: ofcRaw.length, upserted: await upsertByBubbleId("order_factory_category", ofcRows), skipped: ofcSkip };
  const ofcMap = await loadIdMap("order_factory_category");

  // ETD_INFO — de etdfactorieslogs; 1:1 por ofc (dedupe pela última Modified Date)
  const etdRaw = await fetchAll("[vistapub]etdfactorieslogs");
  const byOfc = new Map<string, Row>();
  for (const e of etdRaw) {
    const ofcBid = e["[Vistapub] List of Factories x Categories x Lote"];
    if (typeof ofcBid !== "string") continue;
    const prev = byOfc.get(ofcBid);
    if (!prev || String(e["Modified Date"] ?? "") > String(prev["Modified Date"] ?? "")) byOfc.set(ofcBid, e);
  }
  let etdSkip = 0;
  const etdRows = [...byOfc.entries()]
    .map(([ofcBid, e]) => {
      const ofcId = ofcMap.get(ofcBid);
      if (!ofcId) { etdSkip++; return null; }
      return {
        order_factory_category_id: ofcId,
        remarks: str(e["Remarks"]),
        ready: bool(e["Ready?"]),
        inspection: bool(e["Inspection?"]),
        initial_date: dateOnly(e["Initial Date"]),
        current_date: dateOnly(e["Current Date"]),
        bubble_id: e._id,
      };
    })
    .filter(Boolean) as Row[];
  results.etd_info = { fetched: etdRaw.length, upserted: await upsertByBubbleId("etd_info", etdRows), skipped: etdSkip };

  return results;
}

function shipmentStatus(label: unknown): string {
  const s = norm(label);
  if (s.includes("deliver")) return "delivered";
  if (s.includes("cancel")) return "canceled";
  return "in_transit";
}

async function importPreloadingShipments() {
  const results: Record<string, { fetched: number; upserted: number; skipped?: number }> = {};
  const userMap = await loadIdMap("profiles");
  const podMap = await loadIdMap("pods");
  const clientMap = await loadIdMap("clients");
  const batchMap = await loadIdMap("batches");

  // PRE_LOADINGS
  const plRaw = await fetchAll("[vistapub]pre-loading");
  const plRows = plRaw.map((p) => ({
    pl_number: reqStr(p["PL Number Txt"]) || String(p["PL Number"] ?? p._id),
    created_date: dateOnly(p["Created Date"]) || new Date().toISOString().slice(0, 10),
    client_reference: str(p["[Headers] Cliente Reference"]),
    pod_id: ref(podMap, p["[Headers] POD"]),
    leader_id: ref(userMap, p["[Headers] Leader"]),
    created_by: ref(userMap, p["Created By"]),
    bubble_id: p._id,
  }));
  results.pre_loadings = { fetched: plRaw.length, upserted: await upsertByBubbleId("pre_loadings", plRows) };
  const plMap = await loadIdMap("pre_loadings");

  // pre_loading_clients (List of Clients)
  const plc: Row[] = [];
  for (const p of plRaw) {
    const plId = plMap.get(p._id); if (!plId) continue;
    for (const cid of (Array.isArray(p["List of Clients"]) ? p["List of Clients"] : [])) {
      const c = clientMap.get(cid as string); if (c) plc.push({ pre_loading_id: plId, client_id: c });
    }
  }
  results.pre_loading_clients = { fetched: plc.length, upserted: await upsertJunction("pre_loading_clients", plc, "pre_loading_id,client_id") };

  // pre_loading_batches (List of Order x Lote x PL)
  const plb: Row[] = [];
  for (const p of plRaw) {
    const plId = plMap.get(p._id); if (!plId) continue;
    for (const bid of (Array.isArray(p["List of Order x Lote x PL"]) ? p["List of Order x Lote x PL"] : [])) {
      const b = batchMap.get(bid as string); if (b) plb.push({ pre_loading_id: plId, batch_id: b });
    }
  }
  results.pre_loading_batches = { fetched: plb.length, upserted: await upsertJunction("pre_loading_batches", plb, "pre_loading_id,batch_id") };

  // SHIPMENTS (1:1 com pre_loading)
  const shipRaw = await fetchAll("[vistapub]shippment");
  let shipSkip = 0;
  const seenPl = new Set<string>();
  const shipRows = shipRaw
    .map((s) => {
      const preId = ref(plMap, s["[Vistapub] Pre-Loading"]);
      if (!preId || seenPl.has(preId)) { shipSkip++; return null; }
      seenPl.add(preId);
      return {
        pre_loading_id: preId,
        container_number: str(s["[Header] Container Number"]),
        status: shipmentStatus(s["[Header] Status_OS"]),
        created_by: ref(userMap, s["Created By"]),
        bubble_id: s._id,
      };
    })
    .filter(Boolean) as Row[];
  results.shipments = { fetched: shipRaw.length, upserted: await upsertByBubbleId("shipments", shipRows), skipped: shipSkip };

  return results;
}

// Sorted (1..24) do template do Bubble → valor do enum checklist_step
const STEP_BY_SORTED: (string | null)[] = [
  null, "order", "po", "pi", "deposit_payment", "packing_confirm", "condition_confirm",
  "place_the_order", "etd", "balance_payment", "pre_loading", "consolidation_point", "city",
  "port_of_loading", "shipping_docs", "agents", "booking", "loading_date", "shipping_date",
  "bl", "original_docs", "inspection_report", "eta_brazil", "ata_brazil", "delivered",
];

async function importChecklist() {
  const results: Record<string, { fetched: number; upserted: number; skipped?: number }> = {};
  const userMap = await loadIdMap("profiles");
  const factMap = await loadIdMap("factories");
  const cityMap = await loadIdMap("cities");
  const polMap = await loadIdMap("pols");
  const orderMap = await loadIdMap("orders");
  const plMap = await loadIdMap("pre_loadings");

  // template _id → Sorted (1..24)
  const tmplSorted = new Map<string, number>();
  for (const t of await fetchAll("[vistapub]checklist")) tmplSorted.set(t._id, Number(t.Sorted));

  const plRaw = await fetchAll("[vistapub]pre-loading");

  // item → order uuid  (order."List of Checklist x Item")
  const itemToOrder = new Map<string, string>();
  for (const o of await fetchAll("[vistapub]order")) {
    const oid = orderMap.get(o._id); if (!oid) continue;
    for (const it of (Array.isArray(o["List of Checklist x Item"]) ? o["List of Checklist x Item"] : [])) itemToOrder.set(it as string, oid);
  }
  // item → pre_loading uuid  (pre_loading."[Vistapub] Checklist x Item")
  const itemToPl = new Map<string, string>();
  for (const p of plRaw) {
    const pid = plMap.get(p._id); if (!pid) continue;
    for (const it of (Array.isArray(p["[Vistapub] Checklist x Item"]) ? p["[Vistapub] Checklist x Item"] : [])) itemToPl.set(it as string, pid);
  }

  // O Bubble passou a gravar Consolidation Point / Port of Land / Loading Date /
  // Booking Number como campos DIRETOS no objeto pre-loading (não mais só via
  // "[Value] Factory"/"[Value] POL " do item de checklist). Pra PLs antigos os
  // dois batem; pra PLs recentes só o campo direto tem valor. Usa o direto como
  // fonte principal, com o item de checklist como fallback.
  const plExtra = new Map<
    string,
    {
      consolidation_point_id: string | null;
      pol_id: string | null;
      loading_date_estimated: string | null;
      loading_date_completed: string | null;
      booking_number: string | null;
    }
  >();
  for (const p of plRaw) {
    const pid = plMap.get(p._id); if (!pid) continue;
    plExtra.set(pid, {
      consolidation_point_id: ref(factMap, p["Consolidation Point"]),
      pol_id: ref(polMap, p["Port of Land"]),
      loading_date_estimated: dateOnly(p["Loading Date Estimated"]),
      loading_date_completed: dateOnly(p["Loading Date Completed"]),
      booking_number: str(p["Booking Number"]),
    });
  }

  const items = await fetchAll("[vistapub]checklistxitem");
  const orderSteps = new Map<string, Row>(); // orderId|step (dedupe pela PK lógica)
  const plSteps = new Map<string, Row>();     // plId|step
  let skip = 0;
  for (const it of items) {
    const sorted = tmplSorted.get(it["[Vistapub] Checklist"] as string);
    const step = sorted ? STEP_BY_SORTED[sorted] : null;
    if (!step || !sorted) { skip++; continue; }
    const completed_on = dateOnly(it["Completed date"]);
    const base = {
      step,
      done: completed_on != null,
      estimated_date: dateOnly(it["Estimated date"]),
      responsible_id: ref(userMap, it.Responsible),
      completed_on,
      signed_by_id: ref(userMap, it["Signed By"]),
      bubble_id: it._id as string,
    };
    if (sorted <= 10) {
      const orderId = itemToOrder.get(it._id);
      if (!orderId) { skip++; continue; }
      orderSteps.set(`${orderId}|${step}`, { order_id: orderId, enabled: it["Checklist Yes/no"] !== false, ...base });
    } else {
      const plId = itemToPl.get(it._id);
      if (!plId) { skip++; continue; }
      const extra = plExtra.get(plId);
      // Loading Date: o campo direto do pre-loading é a fonte mais confiável
      // (ver comentário acima de plExtra) — sobrepõe o "Completed/Estimated
      // date" genérico do item quando disponível.
      const completed_on =
        step === "loading_date" ? (extra?.loading_date_completed ?? base.completed_on) : base.completed_on;
      const estimated_date =
        step === "loading_date" ? (extra?.loading_date_estimated ?? base.estimated_date) : base.estimated_date;
      plSteps.set(`${plId}|${step}`, {
        pre_loading_id: plId, ...base,
        completed_on,
        estimated_date,
        done: completed_on != null,
        notes: str(it["[Value] Text"]),
        consolidation_point_id: extra?.consolidation_point_id ?? ref(factMap, it["[Value] Factory"]),
        city_id: ref(cityMap, it["[Value] City"]),
        pol_id: extra?.pol_id ?? ref(polMap, it["[Value] POL "]),
        booking_number: step === "booking" ? (extra?.booking_number ?? null) : null,
      });
    }
  }
  results.order_checklist_steps = { fetched: orderSteps.size, upserted: await upsertByBubbleId("order_checklist_steps", [...orderSteps.values()]), skipped: skip };
  results.pre_loading_checklist_steps = { fetched: plSteps.size, upserted: await upsertByBubbleId("pre_loading_checklist_steps", [...plSteps.values()]) };
  return results;
}

const COUNT_TABLES = [
  "profiles", "countries", "factories", "categories", "category_factories", "cities", "pols",
  "city_pols", "pods", "contacts", "agents", "agent_contacts", "carriers", "clients", "exporters",
  "business_units", "order_types", "shipment_models", "orders", "batches", "order_factory_category", "etd_info",
  "pre_loadings", "pre_loading_clients", "pre_loading_batches", "shipments",
  "order_checklist_steps", "pre_loading_checklist_steps",
];

async function main() {
  const phase = process.argv[2] ?? "all"; // all | base | core | preload | checklist | dates | people

  if (phase === "all" || phase === "base") {
    console.log("== Camada 1: usuários + cadastros ==\n");
    const u = await importUsers();
    console.log(`users/profiles: fetched ${u.fetched}, upserted ${u.upserted}`);
    const cad = await importCadastros();
    for (const [t, r] of Object.entries(cad)) console.log(`${t}: fetched ${r.fetched}, upserted ${r.upserted}`);
  }

  if (phase === "all" || phase === "core") {
    console.log("\n== Camada 2: transacional (núcleo) ==\n");
    const core = await importTransactionalCore();
    for (const [t, r] of Object.entries(core)) {
      console.log(`${t}: fetched ${r.fetched}, upserted ${r.upserted}${r.skipped ? `, skipped ${r.skipped}` : ""}`);
    }
  }

  if (phase === "all" || phase === "preload") {
    console.log("\n== Camada 3: pre-loading + shipments ==\n");
    const pl = await importPreloadingShipments();
    for (const [t, r] of Object.entries(pl)) {
      console.log(`${t}: fetched ${r.fetched}, upserted ${r.upserted}${r.skipped ? `, skipped ${r.skipped}` : ""}`);
    }
  }

  if (phase === "dates") {
    console.log("\n== Backfill: orders.created_at (Data criação) ==\n");
    const bf = await backfillOrderCreatedAt();
    console.log(`orders.created_at: fetched ${bf.fetched}, upserted ${bf.upserted}`);
  }

  if (phase === "people") {
    console.log("\n== Backfill: orders.leader_id / requester_id / exporter_id ==\n");
    const bf = await backfillOrderPeople();
    console.log(`orders (leader/requester/exporter): fetched ${bf.fetched}, upserted ${bf.upserted}`);
  }

  if (phase === "all" || phase === "checklist") {
    console.log("\n== Camada 4: checklist (order + pre-loading/shipment) ==\n");
    const ck = await importChecklist();
    for (const [t, r] of Object.entries(ck)) {
      console.log(`${t}: fetched ${r.fetched}, upserted ${r.upserted}${r.skipped ? `, skipped ${r.skipped}` : ""}`);
    }
  }

  console.log("\n== Contagens no Supabase ==");
  for (const t of COUNT_TABLES) console.log(`${t}: ${await tableCount(t)}`);
}

main().catch((e) => { console.error("FALHOU:", e); process.exit(1); });
