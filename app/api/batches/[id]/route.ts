import type { NextRequest } from "next/server";

import { requireApiFeature, requireApiSession, type ApiSession } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBatch, resolveBatchKey } from "@/domain/batches/api-read";
import { updateBatchSchema } from "@/domain/batches/api-schema";
import { deleteBatch, updateBatch } from "@/domain/batches/api-write";

/**
 * API REST de LOTES (batches) — item.
 *
 *   GET    /api/batches/{id}   → o lote, com order, linhas e PLs
 *   PATCH  /api/batches/{id}   → número, status e linhas (parcial)
 *   DELETE /api/batches/{id}   → apaga; as linhas ficam na order sem lote
 *
 * `{id}` é o UUID do lote ou o `full_number` ("1230.02" — o batch_code do GSS).
 * O UUID vem no GET da coleção, no POST e no
 * GET /api/orders?include=items). Não há PUT: o PATCH já é parcial e o lote
 * não tem campos que justifiquem substituição total. Ver app/api/batches/route.ts.
 */

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

const NOT_FOUND = () => json({ error: "Batch not found." }, 404);

async function authorize(
  action: "view" | "edit"
): Promise<{ ok: true; session: ApiSession } | { ok: false; response: Response }> {
  const auth = await requireApiSession();
  if (!auth.ok) return auth;
  if (auth.session.tokenScope === "po_read") {
    return { ok: false, response: json({ error: "Forbidden" }, 403) };
  }
  const denied = requireApiFeature(auth.session, "orders", action);
  if (denied) return { ok: false, response: denied };
  return auth;
}

export async function GET(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const auth = await authorize("view");
  if (!auth.ok) return auth.response;

  const id = await resolveBatchKey(createAdminClient(), (await ctx.params).id).catch(() => null);
  if (!id) return NOT_FOUND();

  try {
    const batch = await getBatch(createAdminClient(), id);
    return batch ? json({ data: batch }, 200) : NOT_FOUND();
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Failed to read batch." }, 500);
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx): Promise<Response> {
  const auth = await authorize("edit");
  if (!auth.ok) return auth.response;

  const id = await resolveBatchKey(createAdminClient(), (await ctx.params).id).catch(() => null);
  if (!id) return NOT_FOUND();

  const body = await request.json().catch(() => null);
  const parsed = updateBatchSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input.", issues: parsed.error.issues },
      400
    );
  }

  try {
    const result = await updateBatch(createAdminClient(), id, parsed.data);
    return result.ok
      ? json({ data: result.data }, result.status)
      : json({ error: result.error }, result.status);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Failed to update batch." }, 500);
  }
}

export async function DELETE(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const auth = await authorize("edit");
  if (!auth.ok) return auth.response;

  const id = await resolveBatchKey(createAdminClient(), (await ctx.params).id).catch(() => null);
  if (!id) return NOT_FOUND();

  try {
    const result = await deleteBatch(createAdminClient(), id);
    return result.ok
      ? json({ data: result.data }, result.status)
      : json({ error: result.error }, result.status);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Failed to delete batch." }, 500);
  }
}
