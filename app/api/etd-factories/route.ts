import type { NextRequest } from "next/server";

import { requireApiFeature, requireApiSession } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { listGssEtdEntries, parseGssEtdQuery } from "@/domain/etd-factories/gss-read";

/**
 * Leitura GSS → SOTWISE das entradas Factory×Category com ETD (rua "ETD
 * Factories"). Só leitura — os dados nascem na etapa ETD do checklist da
 * Order, dentro do SOTWISE.
 *
 *   GET /api/etd-factories?po_number=&batch_status=&order=&limit=&offset=
 *   Authorization: Bearer $API_TOKEN
 *
 * Mesma auth de /api/orders: token de serviço ou sessão de cookie de um
 * usuário com permissão na feature `etd_factories`.
 *
 * Ao contrário da tela (que só mostra lotes `in_production`/`preloading` por
 * padrão), aqui sem `batch_status` devolve TODOS os status — é um feed de
 * sincronização, não uma tela. Ver domain/etd-factories/gss-read.ts e
 * docs/regras_de_negocio.md §6.2.
 */

export const dynamic = "force-dynamic";

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const denied = requireApiFeature(auth.session, "etd_factories", "view");
  if (denied) return denied;

  const parsed = parseGssEtdQuery(request.nextUrl.searchParams);
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
    const { data, total } = await listGssEtdEntries(admin, query);
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
    return json({ error: err instanceof Error ? err.message : "Failed to list ETD entries." }, 500);
  }
}
