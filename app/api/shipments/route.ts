import type { NextRequest } from "next/server";

import { authorize, invalid, json, listResponse, parseBody, respond, serverError } from "@/lib/api-route";
import { createAdminClient } from "@/lib/supabase/admin";
import { listShipments } from "@/domain/shipments/api-read";
import { createShipmentSchema, parseShipmentQuery } from "@/domain/shipments/api-schema";
import { createShipment } from "@/domain/shipments/api-write";

/**
 * API REST de PL + SHIPMENT — coleção. Um recurso só (como o /v1/shipments/
 * do GSS): o Pre-loading e o embarque que nasce dele.
 *
 *   GET  /api/shipments?pl_number=&po_number=&status=&updated_since=&order=&limit=&offset=
 *   POST /api/shipments   → Create PL (clientes, POD, leader, lotes)
 *
 *   Authorization: Bearer $API_TOKEN
 *
 * Item: app/api/shipments/[id]/route.ts (GET/PATCH/DELETE; o PATCH também faz
 * o Confirm Shipping e o desfazer) e .../[id]/steps/[step] (etapas do
 * checklist). Regras: domain/shipments/api-write.ts.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await authorize("pre_loading", "view");
  if (!auth.ok) return auth.response;

  const parsed = parseShipmentQuery(request.nextUrl.searchParams);
  if (!parsed.success) return invalid(parsed.error, "query");
  const query = parsed.data;

  try {
    const { data, total } = await listShipments(createAdminClient(), query);
    return listResponse(data, total, query);
  } catch (err) {
    if (err instanceof RangeError) return json({ error: err.message }, 400);
    return serverError(err, "Failed to list shipments.");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await authorize("pre_loading", "create");
  if (!auth.ok) return auth.response;

  const body = await parseBody(request, createShipmentSchema);
  if (!body.ok) return body.response;

  try {
    return respond(await createShipment(createAdminClient(), auth.session.userId, body.data));
  } catch (err) {
    return serverError(err, "Failed to create pre-loading.");
  }
}
