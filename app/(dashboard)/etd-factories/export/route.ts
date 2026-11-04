import type { NextRequest } from "next/server";

import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import type { Database } from "@/types/database";

import { parseListState } from "../list-params";
import { buildEtdRows, etdListQuery } from "../query";

export const dynamic = "force-dynamic";

type EtdListRow = Database["public"]["Views"]["etd_list"]["Row"];

/**
 * Linhas do Download XLSX da ETD Factories: TODAS as que a lista mostra com a
 * busca/filtros/ordenação atuais (mesma query de ../page.tsx, sem paginar), no
 * formato da página. A planilha é montada no navegador com as colunas visíveis
 * (lib/xlsx-download).
 */
export async function GET(request: NextRequest): Promise<Response> {
  await requireFeature("etd_factories");
  const admin = createAdminClient();
  const state = parseListState(Object.fromEntries(request.nextUrl.searchParams));

  let failure: string | null = null;
  const list = await fetchAll<EtdListRow>(async (from, to) => {
    const res = await etdListQuery(admin, state).range(from, to);
    if (res.error) failure = res.error.message;
    return res;
  });
  if (failure) return Response.json({ error: `etd_list: ${failure}` }, { status: 500 });

  return Response.json({ rows: buildEtdRows(list) }, { headers: { "Cache-Control": "no-store" } });
}
