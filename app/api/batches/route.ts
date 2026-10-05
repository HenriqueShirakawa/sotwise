import type { NextRequest } from "next/server";

import { requireApiFeature, requireApiSession } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { listBatches } from "@/domain/batches/api-read";
import { createBatchSchema, parseBatchQuery } from "@/domain/batches/api-schema";
import { createBatch } from "@/domain/batches/api-write";

/**
 * API REST de LOTES (batches) — coleção.
 *
 *   GET  /api/batches?order_gss_id=&po_number=&status=&updated_since=&order=&limit=&offset=
 *   POST /api/batches   → cria um lote numa order (opcionalmente já com linhas)
 *
 *   Authorization: Bearer $API_TOKEN
 *
 * Item: app/api/batches/[id]/route.ts (GET/PATCH/DELETE). Mesma auth do resto
 * da API; o lote é da feature `orders` (view para ler, edit para escrever —
 * como na tela). O token só-leitura de PO (`po_read`) NÃO alcança lotes: ele
 * só libera GET /api/orders. Regras: domain/batches/api-write.ts. Contrato:
 * /api/openapi.json (Swagger em /api/docs).
 */

export const dynamic = "force-dynamic";

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  if (auth.session.tokenScope === "po_read") return json({ error: "Forbidden" }, 403);
  const denied = requireApiFeature(auth.session, "orders", "view");
  if (denied) return denied;

  const parsed = parseBatchQuery(request.nextUrl.searchParams);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join(".");
    return json(
      {
        error: where ? `Invalid '${where}': ${issue?.message}` : (issue?.message ?? "Invalid query."),
        issues: parsed.error.issues,
      },
      400
    );
  }
  const query = parsed.data;

  try {
    const { data, total } = await listBatches(createAdminClient(), query);
    return json(
      {
        data,
        pagination: { limit: query.limit, offset: query.offset, returned: data.length, total },
      },
      200
    );
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Failed to list batches." }, 500);
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const denied = requireApiFeature(auth.session, "orders", "edit");
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = createBatchSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input.", issues: parsed.error.issues },
      400
    );
  }

  try {
    const result = await createBatch(createAdminClient(), parsed.data);
    return result.ok
      ? json({ data: result.data }, result.status)
      : json({ error: result.error }, result.status);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Failed to create batch." }, 500);
  }
}
