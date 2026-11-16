import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { json } from "@/lib/api-route";
import type { BatchStatus, OrderStatus } from "@/types/database";

import { mpConfig, type MpConfig } from "./client";
import { normalizeInviteCode, readSession } from "./session";

/**
 * O fornecedor no Mini Program (16/11/2026, docs §6.17): quem é (contato de
 * quais fábricas), o vínculo por convite e as linhas Factory×Category que ele
 * vê. Ele NÃO é usuário do SOT — a identidade é só o OpenID do Mini Program.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

export type SupplierContact = { id: string; factory_id: string; factory_name: string; name: string };

export type SupplierAuth =
  | { ok: true; cfg: MpConfig; admin: AdminClient; openId: string; contacts: SupplierContact[] }
  | { ok: false; response: Response };

export async function contactsOf(admin: AdminClient, openId: string): Promise<SupplierContact[]> {
  const { data, error } = await admin
    .from("factory_wechat_contacts")
    .select("id, factory_id, name, factories!inner(name, deleted_at)")
    .eq("mp_openid", openId)
    .eq("is_active", true)
    .is("factories.deleted_at", null)
    .returns<{ id: string; factory_id: string; name: string; factories: { name: string } | { name: string }[] }[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => {
    const f = Array.isArray(c.factories) ? c.factories[0] : c.factories;
    return { id: c.id, factory_id: c.factory_id, factory_name: f?.name ?? "", name: c.name };
  });
}

/** `Authorization: Bearer <sessão>` → OpenID + contatos ativos. */
export async function authorizeSupplier(request: Request): Promise<SupplierAuth> {
  const cfg = mpConfig();
  if (!cfg) return { ok: false, response: json({ error: "Mini Program is not configured." }, 503) };
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const openId = token ? readSession(cfg.sessionSecret, token) : null;
  if (!openId) return { ok: false, response: json({ error: "Session expired. Please reopen the Mini Program." }, 401) };
  const admin = createAdminClient();
  return { ok: true, cfg, admin, openId, contacts: await contactsOf(admin, openId) };
}

/**
 * Usa o convite: liga este WeChat à fábrica do convite. Uso único; se o WeChat
 * já está ligado àquela fábrica, só atualiza o nome.
 */
export async function bindWithInvite(
  admin: AdminClient,
  openId: string,
  rawCode: string,
  name: string
): Promise<{ ok: true; contact: SupplierContact } | { ok: false; status: 400 | 404 | 409; error: string }> {
  const code = normalizeInviteCode(rawCode);
  if (!code) return { ok: false, status: 400, error: "Invalid invite code." };

  const { data: invite, error } = await admin
    .from("factory_wechat_invites")
    .select("id, factory_id, expires_at, created_by")
    .eq("code", code)
    .is("used_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!invite) return { ok: false, status: 404, error: "Invite code not found or already used." };
  if (Date.parse(invite.expires_at) < Date.now()) {
    return { ok: false, status: 409, error: "This invite has expired. Ask for a new one." };
  }

  const { data: existing } = await admin
    .from("factory_wechat_contacts")
    .select("id")
    .eq("factory_id", invite.factory_id)
    .eq("mp_openid", openId)
    .eq("is_active", true)
    .maybeSingle();

  let contactId = existing?.id ?? null;
  if (contactId) {
    const { error: upError } = await admin.from("factory_wechat_contacts").update({ name }).eq("id", contactId);
    if (upError) throw new Error(upError.message);
  } else {
    const { data: created, error: insError } = await admin
      .from("factory_wechat_contacts")
      .insert({ factory_id: invite.factory_id, mp_openid: openId, name, invited_by: invite.created_by })
      .select("id")
      .single();
    if (insError || !created) throw new Error(insError?.message ?? "Failed to link.");
    contactId = created.id;
  }

  // Marca o convite como usado só se ainda estiver livre (dois celulares ao
  // mesmo tempo: o segundo não "rouba" o convite já usado).
  await admin
    .from("factory_wechat_invites")
    .update({ used_at: new Date().toISOString(), used_by_contact_id: contactId })
    .eq("id", invite.id)
    .is("used_at", null);

  const contact = (await contactsOf(admin, openId)).find((c) => c.id === contactId);
  if (!contact) throw new Error("Linked contact could not be read back.");
  return { ok: true, contact };
}

/** O que o fornecedor vê de cada linha. Datas em YYYY-MM-DD. */
export type SupplierLine = {
  id: string;
  factory_id: string;
  factory: string;
  po_number: string;
  lote: string | null;
  category: string;
  ship_requirement: string | null;
  initial_date: string | null;
  current_date: string | null;
  ready_parts: boolean;
  ready_date: string | null;
};

/** Order ainda em produção: depois disso o ETD não interessa ao fornecedor. */
const OPEN_ORDER: OrderStatus[] = ["in_negotiation", "in_production", "pre_loading"];
/** Lote ainda na fábrica (Pre-Loading entra: Ready parts ainda pode chegar). */
const OPEN_BATCH: BatchStatus[] = ["in_negotiation", "in_production", "preloading"];

type Embed<T> = T | T[] | null;
const one = <T,>(v: Embed<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

type Row = {
  id: string;
  factory_id: string;
  ship_requirement: string | null;
  orders: Embed<{ po_number: string }>;
  batches: Embed<{ batch_number: string; status: BatchStatus }>;
  categories: Embed<{ name: string }>;
  etd_info: Embed<{
    initial_date: string | null;
    current_date: string | null;
    ready: boolean;
    ready_date: string | null;
    is_active: boolean;
  }>;
};

/**
 * Linhas abertas das fábricas do contato: sem Initial Date primeiro (é o que
 * ele precisa responder), depois por ETD mais próxima. `onlyId` = uma linha.
 */
export async function listSupplierLines(
  admin: AdminClient,
  contacts: SupplierContact[],
  onlyId?: string
): Promise<SupplierLine[]> {
  if (contacts.length === 0) return [];
  const factoryName = new Map(contacts.map((c) => [c.factory_id, c.factory_name]));

  let query = admin
    .from("order_factory_category")
    .select(
      "id, factory_id, ship_requirement, orders!inner(po_number, status, deleted_at), " +
        "batches(batch_number, status), categories(name), " +
        "etd_info(initial_date, current_date, ready, ready_date, is_active)"
    )
    .in("factory_id", [...factoryName.keys()])
    .eq("is_active", true)
    .is("orders.deleted_at", null)
    .in("orders.status", OPEN_ORDER)
    .limit(1000);
  if (onlyId) query = query.eq("id", onlyId);

  const { data, error } = await query.returns<Row[]>();
  if (error) throw new Error(error.message);

  const lines: SupplierLine[] = [];
  for (const row of data ?? []) {
    const batch = one(row.batches);
    const etd = one(row.etd_info);
    if (batch && !OPEN_BATCH.includes(batch.status)) continue;
    if (etd && etd.is_active === false) continue;
    lines.push({
      id: row.id,
      factory_id: row.factory_id,
      factory: factoryName.get(row.factory_id) ?? "",
      po_number: one(row.orders)?.po_number ?? "",
      lote: batch?.batch_number ?? null,
      category: one(row.categories)?.name ?? "",
      ship_requirement: row.ship_requirement,
      initial_date: etd?.initial_date ?? null,
      current_date: etd?.current_date ?? null,
      ready_parts: etd?.ready ?? false,
      ready_date: etd?.ready_date ?? null,
    });
  }

  return lines.sort((a, b) => {
    if (!a.initial_date !== !b.initial_date) return a.initial_date ? 1 : -1;
    const da = a.current_date ?? a.ship_requirement ?? "9999";
    const db = b.current_date ?? b.ship_requirement ?? "9999";
    return da.localeCompare(db) || a.po_number.localeCompare(b.po_number);
  });
}
