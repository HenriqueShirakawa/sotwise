import type { NextRequest } from "next/server";

import { authorize, invalid, json, parseBody, respond, serverError } from "@/lib/api-route";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGssOrder, parseGssOrderQuery } from "@/domain/orders/gss-read";
import { gssOrderPatchSchema } from "@/domain/orders/gss-schema";
import { deleteOrder, patchOrder, resolveOrderKey } from "@/domain/orders/api-write";

/**
 * API REST de ORDERS — item.
 *
 *   GET    /api/orders/{id}?include=items,checklist  → a order (mesmo formato da lista)
 *   PATCH  /api/orders/{id}   → cabeçalho, parcial (refs por gss_id, pessoas por e-mail)
 *   DELETE /api/orders/{id}   → hard delete, com as travas da lixeira da tela
 *
 * `{id}` é o UUID ou o `po_number` (ex.: /api/orders/1230). Criar continua no
 * POST /api/orders (upsert por gss_id). Linhas Factory×Category: /api/order-items.
 * O token só-leitura de PO lê (como no GET da coleção), sem `include=checklist`.
 */

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const NOT_FOUND = () => json({ error: "Order not found." }, 404);

export async function GET(request: NextRequest, ctx: Ctx): Promise<Response> {
  const auth = await authorize("orders", "view", { allowPoRead: true });
  if (!auth.ok) return auth.response;

  const parsed = parseGssOrderQuery(request.nextUrl.searchParams);
  if (!parsed.success) return invalid(parsed.error, "query");
  const { include } = parsed.data;
  if (auth.session.tokenScope === "po_read" && include.includes("checklist")) {
    return json({ error: "include=checklist is not available for this token." }, 403);
  }

  try {
    const admin = createAdminClient();
    const id = await resolveOrderKey(admin, (await ctx.params).id);
    if (!id) return NOT_FOUND();
    const order = await getGssOrder(admin, id, include);
    return order ? json({ data: order }, 200) : NOT_FOUND();
  } catch (err) {
    return serverError(err, "Failed to read order.");
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx): Promise<Response> {
  const auth = await authorize("orders", "edit");
  if (!auth.ok) return auth.response;

  const body = await parseBody(request, gssOrderPatchSchema);
  if (!body.ok) return body.response;

  try {
    const admin = createAdminClient();
    const id = await resolveOrderKey(admin, (await ctx.params).id);
    if (!id) return NOT_FOUND();
    return respond(await patchOrder(admin, id, body.data));
  } catch (err) {
    return serverError(err, "Failed to update order.");
  }
}

export async function DELETE(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const auth = await authorize("orders", "delete");
  if (!auth.ok) return auth.response;

  try {
    const admin = createAdminClient();
    const id = await resolveOrderKey(admin, (await ctx.params).id);
    if (!id) return NOT_FOUND();
    return respond(await deleteOrder(admin, id));
  } catch (err) {
    return serverError(err, "Failed to delete order.");
  }
}
