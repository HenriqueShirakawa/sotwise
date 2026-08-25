import { createHash, timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { gssOrderSchema, type GssOrderInput } from "@/domain/orders/gss-schema";

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
 *
 * `po_number` vem do GSS e é unique no banco: colisão com um número já usado
 * (pela app ou por outra order) responde 409. `requester_id`/`leader_id`
 * apontam para `profiles` (usuários do SOTWISE, sem `gss_id`) e nascem NULL.
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

/** Campos da order derivados do payload (sem gss_id/po_number/status). */
async function buildFields(
  admin: AdminClient,
  input: GssOrderInput
): Promise<{ ok: true; fields: Record<string, unknown> } | { ok: false; error: string }> {
  const fields: Record<string, unknown> = {
    schedule_requested: input.schedule_requested ?? null,
    client_reference: input.client_reference ?? null,
    // date_po = data de abertura do pedido (a UI de ETD mostra "—" sem ela).
    date_po: input.date_po ?? new Date().toISOString().slice(0, 10),
  };

  for (const [key, { table, column }] of Object.entries(FK_LIBS)) {
    const resolved = await resolveFk(admin, table, input[key as keyof GssOrderInput] as string | null | undefined);
    if (!resolved.ok) return resolved;
    fields[column] = resolved.id;
  }

  return { ok: true, fields };
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
    const { data, error } = await admin
      .from("orders")
      .update({ ...built.fields, po_number: input.po_number })
      .eq("id", existing.id)
      .select("id, po_number")
      .single();
    if (error) {
      // Colisão de po_number com OUTRA order.
      if (error.code === "23505") {
        return json({ error: `po_number '${input.po_number}' is already in use.` }, 409);
      }
      return json({ error: error.message }, 500);
    }
    return json({ data, created: false }, 200);
  }

  const { data, error } = await admin
    .from("orders")
    .insert({ ...built.fields, gss_id: input.gss_id, po_number: input.po_number })
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
  return json({ data, created: true }, 201);
}
