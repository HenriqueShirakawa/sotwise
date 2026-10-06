import "server-only";

import { revalidatePath } from "next/cache";

import { broadcastOrderStatusPing } from "@/lib/orders-realtime";
import type { createAdminClient } from "@/lib/supabase/admin";
import { fail, isUuid, type WriteResult } from "@/domain/api/write-result";

import { deleteOrderWithRules } from "./delete-rules";
import type { GssOrderHeaderInput, GssOrderItemInput, GssOrderPatchInput } from "./gss-schema";

/**
 * Escrita de ORDERS pela API: o upsert do POST /api/orders (helpers abaixo) e
 * o item REST `PATCH`/`DELETE /api/orders/{id}`.
 *
 * As FKs chegam pelo `gss_id` da biblioteca e as pessoas pelo e-mail — mesmo
 * contrato do POST. O PATCH só mexe no cabeçalho; o DELETE usa as MESMAS travas
 * da lixeira da tela (domain/orders/delete-rules.ts).
 */

type AdminClient = ReturnType<typeof createAdminClient>;
type UUID = string;

/** Bibliotecas cujo `gss_id` o payload referencia → coluna FK na order. */
const FK_LIBS = {
  order_type_gss_id: { table: "order_types", column: "order_type_id" },
  client_gss_id: { table: "clients", column: "client_id" },
  business_unit_gss_id: { table: "business_units", column: "business_unit_id" },
  exporter_gss_id: { table: "exporters", column: "exporter_id" },
} as const;

type FkLibTable = (typeof FK_LIBS)[keyof typeof FK_LIBS]["table"];

/** Pessoas (profiles) que o payload manda por e-mail → coluna na order. */
const PEOPLE = {
  leader_email: "leader_id",
  requester_email: "requester_id",
  operational_responsible_email: "operational_responsible_id",
} as const;

/** Traduz um `gss_id` de biblioteca no UUID interno. null quando não informado. */
async function resolveFk(
  admin: AdminClient,
  table: FkLibTable,
  gssId: string | null | undefined
): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  if (!gssId) return { ok: true, id: null };
  const { data, error } = await admin
    .from(table)
    .select("id")
    .eq("gss_id", gssId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: `No ${table} found for gss_id '${gssId}'.` };
  return { ok: true, id: (data as { id: string }).id };
}

/** Traduz um e-mail no id do profile (usuário do SOTWISE). null quando não informado. */
export async function resolveProfileByEmail(
  admin: AdminClient,
  email: string | null | undefined
): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  if (!email) return { ok: true, id: null };
  const { data, error } = await admin.rpc("profile_id_by_email", { p_email: email });
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: `No SOTWISE user found for e-mail '${email}'.` };
  return { ok: true, id: data };
}

/**
 * Campos da order derivados do payload (sem gss_id/po_number/status). É PARCIAL:
 * inclui SÓ as colunas cujo campo veio no payload (`!== undefined`). Assim o
 * reenvio toca apenas o que mandar e NÃO zera o resto — essencial porque, no
 * GSS, criar a order e depois preencher dados/itens acontece em momentos
 * distintos. `null` explícito limpa a coluna; ausente não mexe. `date_po` não é
 * defaultado aqui — o default "hoje" vale só na criação (ver POST).
 */
export async function buildOrderFields(
  admin: AdminClient,
  input: GssOrderHeaderInput
): Promise<{ ok: true; fields: Record<string, unknown> } | { ok: false; error: string }> {
  const fields: Record<string, unknown> = {};

  if (input.schedule_requested !== undefined) fields.schedule_requested = input.schedule_requested;
  if (input.client_reference !== undefined) fields.client_reference = input.client_reference;
  if (input.date_po !== undefined) fields.date_po = input.date_po;

  for (const [key, { table, column }] of Object.entries(FK_LIBS)) {
    const raw = input[key as keyof typeof FK_LIBS];
    if (raw === undefined) continue; // campo omitido → não mexe nessa coluna
    const resolved = await resolveFk(admin, table, raw);
    if (!resolved.ok) return resolved;
    fields[column] = resolved.id; // string → UUID; null explícito → limpa
  }

  // Leader/Requester/Operational Responsible chegam por e-mail e viram id de
  // profile (só se vieram).
  for (const [key, column] of Object.entries(PEOPLE)) {
    const email = input[key as keyof typeof PEOPLE];
    if (email === undefined) continue;
    const person = await resolveProfileByEmail(admin, email);
    if (!person.ok) return person;
    fields[column] = person.id;
  }

  return { ok: true, fields };
}

/**
 * Cria as linhas Factory×Category (order_factory_category) da order a partir de
 * `items`. Cada item traz o `gss_id` do supplier-category, do qual derivamos
 * fábrica+categoria via `factory_products`. As linhas nascem SEM lote
 * (`batch_id` null) — o usuário atribui o lote depois no SOTWISE.
 *
 * Idempotente e NÃO destrutivo: um par (factory, category) que já existe na
 * order não é recriado nem tem `batch_id`/`ship_requirement` sobrescritos — assim
 * um reenvio do GSS pode ADICIONAR linhas novas sem apagar o trabalho de lote do
 * usuário. Pares duplicados dentro do mesmo payload são colapsados.
 */
export async function applyOrderItems(
  admin: AdminClient,
  orderId: string,
  items: GssOrderItemInput[] | null | undefined
): Promise<{ ok: true } | { ok: false; error: string; status: 400 | 500 }> {
  if (!items || items.length === 0) return { ok: true };

  // Resolve todos os supplier-category ANTES de inserir (fail-fast).
  const resolved: { factory_id: string; category_id: string; ship_requirement: string }[] = [];
  for (const item of items) {
    const { data, error } = await admin
      .from("factory_products")
      .select("factory_id, category_id")
      .eq("gss_id", item.supplier_category_gss_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return { ok: false, status: 500, error: error.message };
    if (!data) {
      return {
        ok: false,
        status: 400,
        error: `No factory_products found for supplier_category_gss_id '${item.supplier_category_gss_id}'.`,
      };
    }
    resolved.push({
      factory_id: (data as { factory_id: string }).factory_id,
      category_id: (data as { category_id: string }).category_id,
      ship_requirement: item.ship_requirement,
    });
  }

  // Pares já existentes na order → não recriar (preserva lote + ship_requirement).
  const { data: existingRows, error: exErr } = await admin
    .from("order_factory_category")
    .select("factory_id, category_id")
    .eq("order_id", orderId);
  if (exErr) return { ok: false, status: 500, error: exErr.message };

  const seen = new Set(
    (existingRows ?? []).map(
      (r) => `${(r as { factory_id: string }).factory_id}:${(r as { category_id: string }).category_id}`
    )
  );

  const toInsert: {
    order_id: string;
    factory_id: string;
    category_id: string;
    ship_requirement: string;
  }[] = [];
  for (const r of resolved) {
    const key = `${r.factory_id}:${r.category_id}`;
    if (seen.has(key)) continue; // já existe (na order ou repetido no payload)
    seen.add(key);
    toInsert.push({
      order_id: orderId,
      factory_id: r.factory_id,
      category_id: r.category_id,
      ship_requirement: r.ship_requirement,
      // batch_id fica null de propósito — o usuário atribui o lote depois.
    });
  }

  if (toInsert.length === 0) return { ok: true };

  const { error: insErr } = await admin.from("order_factory_category").insert(toInsert);
  if (insErr) return { ok: false, status: 500, error: insErr.message };
  return { ok: true };
}

/**
 * `{id}` das rotas de order: UUID ou o `po_number` (ex.: /api/orders/1230).
 * Só orders vivas (o GET de orders esconde as soft-deleted).
 */
export async function resolveOrderKey(admin: AdminClient, key: string): Promise<UUID | null> {
  const column = isUuid(key) ? "id" : "po_number";
  const { data, error } = await admin
    .from("orders")
    .select("id")
    .eq(column, key)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

function refreshOrderViews() {
  revalidatePath("/orders/[id]", "page");
  revalidatePath("/orders");
}

/** `PATCH /api/orders/{id}` — cabeçalho parcial. */
export async function patchOrder(
  admin: AdminClient,
  orderId: UUID,
  input: GssOrderPatchInput
): Promise<WriteResult<{ id: UUID; po_number: string }>> {
  const built = await buildOrderFields(admin, input);
  if (!built.ok) return fail(400, built.error);

  const { data, error } = await admin
    .from("orders")
    .update(built.fields as never)
    .eq("id", orderId)
    .select("id, po_number")
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(404, "Order not found.");

  refreshOrderViews();
  await broadcastOrderStatusPing({ order_ids: [orderId] });
  return { ok: true, status: 200, data };
}

/** `DELETE /api/orders/{id}` — hard delete com as travas da tela. */
export async function deleteOrder(
  admin: AdminClient,
  orderId: UUID
): Promise<WriteResult<{ id: UUID; deleted: true }>> {
  const result = await deleteOrderWithRules(admin, orderId);
  if (!result.ok) return fail(result.status, result.error);

  refreshOrderViews();
  await broadcastOrderStatusPing({ order_ids: [orderId] });
  return { ok: true, status: 200, data: { id: orderId, deleted: true } };
}
