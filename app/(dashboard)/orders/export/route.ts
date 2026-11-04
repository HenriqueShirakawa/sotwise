import type { NextRequest } from "next/server";

import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import type { Database } from "@/types/database";

import { parseListState } from "../list-params";
import { ordersListQuery, toOrderRow } from "../query";

export const dynamic = "force-dynamic";

type OrdersListRow = Database["public"]["Views"]["orders_list"]["Row"];

/**
 * Linhas do Download XLSX de Orders: TODAS as que a lista mostra com a
 * busca/cliente/filtros/ordenação atuais (mesma query de ../page.tsx, sem
 * paginar). A planilha é montada no navegador com as colunas visíveis.
 */
export async function GET(request: NextRequest): Promise<Response> {
  await requireFeature("orders");
  const admin = createAdminClient();
  const state = parseListState(Object.fromEntries(request.nextUrl.searchParams));

  let failure: string | null = null;
  const list = await fetchAll<OrdersListRow>(async (from, to) => {
    const res = await ordersListQuery(admin, state).range(from, to);
    if (res.error) failure = res.error.message;
    return res;
  });
  if (failure) return Response.json({ error: `orders_list: ${failure}` }, { status: 500 });

  return Response.json({ rows: list.map(toOrderRow) }, { headers: { "Cache-Control": "no-store" } });
}
