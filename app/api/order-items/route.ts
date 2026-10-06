import type { NextRequest } from "next/server";

import { authorize, invalid, listResponse, parseBody, respond, serverError } from "@/lib/api-route";
import { createAdminClient } from "@/lib/supabase/admin";
import { listOrderItems } from "@/domain/order-items/api-read";
import { createOrderItemSchema, parseOrderItemQuery } from "@/domain/order-items/api-schema";
import { createOrderItem } from "@/domain/order-items/api-write";

/**
 * API REST das linhas FACTORY × CATEGORY — coleção.
 *
 *   GET  /api/order-items?po_number=&order_gss_id=&batch_id=&unassigned=true&updated_since=&order=&limit=&offset=
 *   POST /api/order-items   → cria a linha numa order (com lote opcional)
 *
 *   Authorization: Bearer $API_TOKEN
 *
 * Item: app/api/order-items/[id]/route.ts. A linha é da feature `orders` (como
 * na tela da Order). Regras: domain/order-items/api-write.ts.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await authorize("orders", "view");
  if (!auth.ok) return auth.response;

  const parsed = parseOrderItemQuery(request.nextUrl.searchParams);
  if (!parsed.success) return invalid(parsed.error, "query");
  const query = parsed.data;

  try {
    const { data, total } = await listOrderItems(createAdminClient(), query);
    return listResponse(data, total, query);
  } catch (err) {
    return serverError(err, "Failed to list items.");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await authorize("orders", "edit");
  if (!auth.ok) return auth.response;

  const body = await parseBody(request, createOrderItemSchema);
  if (!body.ok) return body.response;

  try {
    return respond(await createOrderItem(createAdminClient(), body.data));
  } catch (err) {
    return serverError(err, "Failed to create item.");
  }
}
