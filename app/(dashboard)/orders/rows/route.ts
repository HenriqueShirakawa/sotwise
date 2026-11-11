import { resolveSession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";

import { parseListState } from "../list-params";
import { fetchOrdersPage } from "../query";

/**
 * GET /orders/rows?<mesma query string da lista> → só as linhas da página
 * (JSON). Criada em 04/11/2026 porque trocar de página navegando re-renderizava
 * a página inteira e reenviava todos os cadastros dos seletores (~52 KB por
 * clique); aqui volta só o que muda (~5 KB) e o cliente pré-carrega as páginas
 * vizinhas. Mesma permissão da tela (feature `orders`, view).
 */
export async function GET(request: Request) {
  const result = await resolveSession();
  if (result.kind !== "ok") {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!result.session.permissions.orders.view) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const page = await fetchOrdersPage(createAdminClient(), parseListState(params));
  return Response.json(page, { headers: { "Cache-Control": "private, no-store" } });
}
