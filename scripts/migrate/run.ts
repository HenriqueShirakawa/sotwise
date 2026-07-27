/**
 * Importador Bubble (LIVE) → Supabase. Idempotente (upsert por bubble_id).
 * Camada 1: usuários/profiles + cadastros. (Transacional/checklist: próxima camada.)
 * Uso: npm run migrate
 */
import { supabaseAdmin } from "./client";
import { fetchAll } from "./bubble";
import {
  upsertByBubbleId, upsertJunction, loadIdMap, tableCount,
  str, reqStr, bool, ref,
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

async function main() {
  console.log("== Camada 1: usuários + cadastros ==\n");
  const u = await importUsers();
  console.log(`users/profiles: fetched ${u.fetched}, upserted ${u.upserted}`);
  const cad = await importCadastros();
  for (const [t, r] of Object.entries(cad)) console.log(`${t}: fetched ${r.fetched}, upserted ${r.upserted}`);

  console.log("\n== Contagens no Supabase ==");
  const tables = ["profiles", "countries", "factories", "categories", "category_factories", "cities", "pols", "city_pols", "pods", "contacts", "agents", "agent_contacts", "carriers", "clients", "exporters", "business_units", "order_types", "shipment_models"];
  for (const t of tables) console.log(`${t}: ${await tableCount(t)}`);
}

main().catch((e) => { console.error("FALHOU:", e); process.exit(1); });
