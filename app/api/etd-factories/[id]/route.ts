import type { NextRequest } from "next/server";

import { authorize, json, parseBody, respond, serverError } from "@/lib/api-route";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/domain/api/write-result";
import { getGssEtdEntry } from "@/domain/etd-factories/gss-read";
import { patchEtd, patchEtdSchema } from "@/domain/etd-factories/api-write";

/**
 * ETD de UMA linha Factory×Category.
 *
 *   GET   /api/etd-factories/{id}   → a linha, no formato do GET da lista
 *   PATCH /api/etd-factories/{id}   → initial_date, current_date, ready_parts, remarks
 *
 * `{id}` = o `id` que o GET /api/etd-factories devolve (é o da linha
 * Factory×Category). Sem POST/DELETE: o ETD nasce e morre com a linha
 * (/api/order-items). Regras: domain/etd-factories/api-write.ts. Mesma
 * permissão da tela: `orders.edit` OU `etd_factories.edit`.
 */

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const NOT_FOUND = () => json({ error: "Item not found." }, 404);

export async function GET(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const auth = await authorize("etd_factories", "view");
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!isUuid(id)) return NOT_FOUND();

  try {
    const entry = await getGssEtdEntry(createAdminClient(), id);
    return entry ? json({ data: entry }, 200) : NOT_FOUND();
  } catch (err) {
    return serverError(err, "Failed to read ETD.");
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx): Promise<Response> {
  // Como a tela: quem edita a Order OU a tela ETD Factories pode mexer no ETD.
  let auth = await authorize("etd_factories", "edit");
  if (!auth.ok) {
    const viaOrders = await authorize("orders", "edit");
    if (!viaOrders.ok) return auth.response;
    auth = viaOrders;
  }

  const { id } = await ctx.params;
  if (!isUuid(id)) return NOT_FOUND();

  const body = await parseBody(request, patchEtdSchema);
  if (!body.ok) return body.response;

  try {
    return respond(await patchEtd(createAdminClient(), auth.session.userId, id, body.data));
  } catch (err) {
    return serverError(err, "Failed to update ETD.");
  }
}
