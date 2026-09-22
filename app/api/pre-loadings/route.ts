import type { NextRequest } from "next/server";

import { requireApiFeature, requireApiSession } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { listGssPreLoadings, parseGssPreLoadingQuery } from "@/domain/pre-loadings/gss-read";

/**
 * Leitura GSS → SOTWISE de PL (Pre-loading/Shipment). Só leitura — o PL nasce
 * e evolui inteiramente dentro do SOTWISE (checklist, confirmação de
 * embarque); o GSS só consulta o estado.
 *
 *   GET /api/pre-loadings?pl_number=&po_number=&order=&limit=&offset=
 *   Authorization: Bearer $API_TOKEN
 *
 * Mesma auth de /api/orders (`requireApiSession()`, lib/api-auth.ts): token
 * de serviço ou sessão de cookie de um usuário com permissão na feature
 * `pre_loading`.
 *
 * Cada linha é um PL. `ETD`/`ETA_Brazil` saem como a data ESTIMADA das etapas
 * "Shipping Date"/"ETA Brazil" do checklist único do PL
 * (pre_loading_checklist_steps); `shipping_date`/`ATA_Brazil`/
 * `DELIVERED_DATE` são a data REAL (`completed_on`) das etapas
 * correspondentes — ver domain/pre-loadings/gss-read.ts e
 * docs/regras_de_negocio.md §6.2. Campos ficam `null` até a etapa ser
 * preenchida: um PL sem embarque ainda devolve as 6 últimas colunas vazias.
 */

export const dynamic = "force-dynamic";

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const denied = requireApiFeature(auth.session, "pre_loading", "view");
  if (denied) return denied;

  const parsed = parseGssPreLoadingQuery(request.nextUrl.searchParams);
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

  const admin = createAdminClient();
  try {
    const { data, total } = await listGssPreLoadings(admin, query);
    return json(
      {
        data,
        pagination: {
          limit: query.limit,
          offset: query.offset,
          returned: data.length,
          total,
        },
      },
      200
    );
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Failed to list pre-loadings." }, 500);
  }
}
