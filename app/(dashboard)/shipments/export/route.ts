import type { NextRequest } from "next/server";

import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import type { Database } from "@/types/database";

import { parseListState } from "../list-params";
import { polNameFor, shipmentsListQuery, toShipmentRow } from "../query";

export const dynamic = "force-dynamic";

type ShipmentsListRow = Database["public"]["Views"]["shipments_list"]["Row"];

/**
 * Linhas do Download XLSX de Shipments: TODAS as que a lista mostra com a
 * busca/filtros/ordenação atuais (mesma query de ../page.tsx, sem paginar).
 * A planilha é montada no navegador com as colunas visíveis.
 */
export async function GET(request: NextRequest): Promise<Response> {
  await requireFeature("shipments");
  const admin = createAdminClient();
  const state = parseListState(Object.fromEntries(request.nextUrl.searchParams));

  const polName = await polNameFor(admin, state);
  let failure: string | null = null;
  const list = await fetchAll<ShipmentsListRow>(async (from, to) => {
    const res = await shipmentsListQuery(admin, state, polName).range(from, to);
    if (res.error) failure = res.error.message;
    return res;
  });
  if (failure) return Response.json({ error: `shipments_list: ${failure}` }, { status: 500 });

  return Response.json({ rows: list.map(toShipmentRow) }, { headers: { "Cache-Control": "no-store" } });
}
