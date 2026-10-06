import type { NextRequest } from "next/server";

import { authorize, json, parseBody, respond, serverError } from "@/lib/api-route";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/domain/api/write-result";
import { getOrderItem } from "@/domain/order-items/api-read";
import { updateOrderItemSchema } from "@/domain/order-items/api-schema";
import { deleteOrderItem, updateOrderItem } from "@/domain/order-items/api-write";

/**
 * API REST das linhas FACTORY × CATEGORY — item.
 *
 *   GET    /api/order-items/{id}
 *   PATCH  /api/order-items/{id}   → batch_id (mover; null = tirar do lote), ship_requirement
 *   DELETE /api/order-items/{id}   → apaga (lote editável; lote In Production não fica vazio)
 *
 * `{id}` é o UUID da linha (o mesmo de GET /api/orders?include=items).
 */

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const NOT_FOUND = () => json({ error: "Item not found." }, 404);

export async function GET(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const auth = await authorize("orders", "view");
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!isUuid(id)) return NOT_FOUND();

  try {
    const item = await getOrderItem(createAdminClient(), id);
    return item ? json({ data: item }, 200) : NOT_FOUND();
  } catch (err) {
    return serverError(err, "Failed to read item.");
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx): Promise<Response> {
  const auth = await authorize("orders", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!isUuid(id)) return NOT_FOUND();

  const body = await parseBody(request, updateOrderItemSchema);
  if (!body.ok) return body.response;

  try {
    return respond(await updateOrderItem(createAdminClient(), id, body.data));
  } catch (err) {
    return serverError(err, "Failed to update item.");
  }
}

export async function DELETE(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const auth = await authorize("orders", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!isUuid(id)) return NOT_FOUND();

  try {
    return respond(await deleteOrderItem(createAdminClient(), id));
  } catch (err) {
    return serverError(err, "Failed to delete item.");
  }
}
