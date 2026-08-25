import { createHash, timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  gssOrderSchema,
  type GssOrderInput,
  type GssOrderItemInput,
} from "@/domain/orders/gss-schema";

/**
 * Via de entrada GSS → SOTWISE para criar/atualizar ORDERS (push).
 *
 *   POST /api/gss/orders
 *   Authorization: Bearer $GSS_INBOUND_SECRET
 *
 * É a primeira via inbound da integração (o resto é pull: o SOTWISE puxa as
 * bibliotecas). Fluxo:
 *   1. Autoriza por secret dedicado (server-to-server, não sessão de usuário).
 *   2. Valida o payload (domain/orders/gss-schema.ts).
 *   3. Resolve cada `*_gss_id` para o UUID interno da biblioteca.
 *   4. Upsert por `orders.gss_id` (idempotente: retry do GSS não duplica).
 *   5. O checklist NÃO é semeado aqui — o trigger `trg_orders_seed_checklist`
 *      (migration 20260824120000) cria as 10 etapas em todo INSERT de order.
 *   6. `items[]` (opcional) vira as linhas Factory×Category em
 *      `order_factory_category`: cada item traz o `gss_id` do supplier-category
 *      (→ `factory_products` → fábrica+categoria). As linhas nascem SEM lote
 *      (o usuário atribui depois). Não destrutivo: reenvio só ADICIONA pares
 *      novos, preservando o lote que o usuário já atribuiu.
 *
 * `po_number` vem do GSS e é unique no banco: colisão com um número já usado
 * (pela app ou por outra order) responde 409. `requester_id`/`leader_id`
 * apontam para `profiles` (usuários do SOTWISE, sem `gss_id`); o GSS os manda
 * por e-mail (`leader_email`/`requester_email`), resolvido para o id do profile
 * via a função `public.profile_id_by_email`. Ausentes → NULL.
 */

export const dynamic = "force-dynamic";

type AdminClient = ReturnType<typeof createAdminClient>;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

/** Compara em tempo constante, sem depender de os tamanhos baterem. */
function secretMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Bibliotecas cujo `gss_id` o payload referencia → coluna FK na order. */
const FK_LIBS = {
  order_type_gss_id: { table: "order_types", column: "order_type_id" },
  client_gss_id: { table: "clients", column: "client_id" },
  business_unit_gss_id: { table: "business_units", column: "business_unit_id" },
  exporter_gss_id: { table: "exporters", column: "exporter_id" },
} as const;

type FkLibTable = (typeof FK_LIBS)[keyof typeof FK_LIBS]["table"];

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
async function resolveProfileByEmail(
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
async function buildFields(
  admin: AdminClient,
  input: GssOrderInput
): Promise<{ ok: true; fields: Record<string, unknown> } | { ok: false; error: string }> {
  const fields: Record<string, unknown> = {};

  if (input.schedule_requested !== undefined) fields.schedule_requested = input.schedule_requested;
  if (input.client_reference !== undefined) fields.client_reference = input.client_reference;
  if (input.date_po !== undefined) fields.date_po = input.date_po;

  for (const [key, { table, column }] of Object.entries(FK_LIBS)) {
    const raw = input[key as keyof GssOrderInput] as string | null | undefined;
    if (raw === undefined) continue; // campo omitido → não mexe nessa coluna
    const resolved = await resolveFk(admin, table, raw);
    if (!resolved.ok) return resolved;
    fields[column] = resolved.id; // string → UUID; null explícito → limpa
  }

  // Leader/Requester chegam por e-mail e viram id de profile (só se vieram).
  if (input.leader_email !== undefined) {
    const leader = await resolveProfileByEmail(admin, input.leader_email);
    if (!leader.ok) return leader;
    fields.leader_id = leader.id;
  }
  if (input.requester_email !== undefined) {
    const requester = await resolveProfileByEmail(admin, input.requester_email);
    if (!requester.ok) return requester;
    fields.requester_id = requester.id;
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
async function applyOrderItems(
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

export async function POST(request: NextRequest): Promise<Response> {
  const expected = process.env.GSS_INBOUND_SECRET;
  if (!expected) {
    return json({ error: "GSS_INBOUND_SECRET not configured." }, 503);
  }
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !secretMatches(token, expected)) {
    return json({ error: "Unauthorized." }, 401);
  }

  const body = await request.json().catch(() => null);
  const parsed = gssOrderSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input.", issues: parsed.error.issues },
      400
    );
  }
  const input = parsed.data;

  const admin = createAdminClient();

  const built = await buildFields(admin, input);
  if (!built.ok) return json({ error: built.error }, 400);

  // Idempotência: existe order com esse gss_id? Reenvio atualiza; senão insere.
  const { data: existing, error: lookupError } = await admin
    .from("orders")
    .select("id")
    .eq("gss_id", input.gss_id)
    .maybeSingle();
  if (lookupError) return json({ error: lookupError.message }, 500);

  if (existing) {
    const updateRow: Record<string, unknown> = { ...built.fields };
    if (input.po_number !== undefined) updateRow.po_number = input.po_number;

    // Se o reenvio só trouxe itens (nada de cabeçalho nem po_number), não há
    // coluna para o SET — busca a order para devolver id/po_number sem um UPDATE
    // vazio (que o PostgREST rejeitaria).
    const { data, error } =
      Object.keys(updateRow).length > 0
        ? await admin
            .from("orders")
            .update(updateRow as never)
            .eq("id", existing.id)
            .select("id, po_number")
            .single()
        : await admin
            .from("orders")
            .select("id, po_number")
            .eq("id", existing.id)
            .single();
    if (error) {
      // Colisão de po_number com OUTRA order.
      if (error.code === "23505") {
        return json({ error: `po_number '${input.po_number}' is already in use.` }, 409);
      }
      return json({ error: error.message }, 500);
    }
    // Reenvio pode adicionar linhas Factory×Category novas (sem apagar as antigas).
    const items = await applyOrderItems(admin, data.id, input.items);
    if (!items.ok) return json({ error: items.error }, items.status);
    return json({ data, created: false }, 200);
  }

  // A partir daqui é CRIAÇÃO: po_number é obrigatório para nascer a order.
  if (!input.po_number) {
    return json({ error: "po_number is required to create an order." }, 400);
  }

  // date_po default = hoje SÓ na criação (a UI de ETD mostra "—" sem ela).
  const createRow: Record<string, unknown> = {
    ...built.fields,
    gss_id: input.gss_id,
    po_number: input.po_number,
  };
  if (createRow.date_po === undefined) {
    createRow.date_po = new Date().toISOString().slice(0, 10);
  }
  const { data, error } = await admin
    .from("orders")
    .insert(createRow as never)
    .select("id, po_number")
    .single();
  if (error) {
    // Já checamos que o gss_id não existia; um 23505 aqui é colisão de po_number
    // (ou corrida de dois POSTs com o mesmo gss_id ao mesmo tempo).
    if (error.code === "23505") {
      return json(
        { error: `Conflict: po_number '${input.po_number}' or gss_id '${input.gss_id}' already exists.` },
        409
      );
    }
    return json({ error: error.message }, 500);
  }

  // O trigger trg_orders_seed_checklist já semeou as 10 etapas do checklist.
  // Agora as linhas Factory×Category (sem lote — o usuário atribui depois).
  const items = await applyOrderItems(admin, data.id, input.items);
  if (!items.ok) return json({ error: items.error }, items.status);

  return json({ data, created: true }, 201);
}
