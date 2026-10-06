import type { NextRequest } from "next/server";

import { authorize, json, parseBody, respond, serverError } from "@/lib/api-route";
import { createAdminClient } from "@/lib/supabase/admin";
import { getShipment, resolveShipmentKey } from "@/domain/shipments/api-read";
import { patchShipmentSchema } from "@/domain/shipments/api-schema";
import { deleteShipment, patchShipment } from "@/domain/shipments/api-write";

/**
 * API REST de PL + SHIPMENT — item. `{id}` = UUID do PL ou o `pl_number`
 * (ex.: /api/shipments/1306).
 *
 *   GET    /api/shipments/{id}
 *   PATCH  /api/shipments/{id}   → cabeçalho/lotes (só antes de embarcar);
 *                                  status "in_transit" + confirm = Confirm Shipping;
 *                                  status "preloading" = desfaz o embarque
 *   DELETE /api/shipments/{id}   → apaga o PL (só não embarcado)
 *
 * Permissões como na tela: o PL é `pre_loading`; desfazer o embarque exige
 * `shipments.delete` (a ação mais destrutiva da tela de Shipment).
 */

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const NOT_FOUND = () => json({ error: "Pre-loading not found." }, 404);

export async function GET(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const auth = await authorize("pre_loading", "view");
  if (!auth.ok) return auth.response;

  try {
    const admin = createAdminClient();
    const id = await resolveShipmentKey(admin, (await ctx.params).id);
    if (!id) return NOT_FOUND();
    const row = await getShipment(admin, id);
    return row ? json({ data: row }, 200) : NOT_FOUND();
  } catch (err) {
    return serverError(err, "Failed to read shipment.");
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx): Promise<Response> {
  const body = await parseBody(request, patchShipmentSchema);
  // Autoriza antes de responder qualquer coisa sobre o body.
  const auth =
    body.ok && body.data.status === "preloading"
      ? await authorize("shipments", "delete")
      : await authorize("pre_loading", "edit");
  if (!auth.ok) return auth.response;
  if (!body.ok) return body.response;

  try {
    const admin = createAdminClient();
    const id = await resolveShipmentKey(admin, (await ctx.params).id);
    if (!id) return NOT_FOUND();
    return respond(await patchShipment(admin, auth.session.userId, id, body.data));
  } catch (err) {
    return serverError(err, "Failed to update shipment.");
  }
}

export async function DELETE(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const auth = await authorize("pre_loading", "delete");
  if (!auth.ok) return auth.response;

  try {
    const admin = createAdminClient();
    const id = await resolveShipmentKey(admin, (await ctx.params).id);
    if (!id) return NOT_FOUND();
    return respond(await deleteShipment(admin, id));
  } catch (err) {
    return serverError(err, "Failed to delete pre-loading.");
  }
}
