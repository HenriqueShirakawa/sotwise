import { verifySession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OrderStatus } from "@/types/database";

import { ClientsClient, type ClientRow } from "./clients-client";

/** Status que viram coluna na lista (§3.5.5 / tela do Bubble). Os demais
 * (partially_shipped, partially_delivered) entram só no Total — como no Bubble. */
const COUNTED: OrderStatus[] = [
  "in_negotiation",
  "in_production",
  "shipped",
  "delivered",
  "canceled",
];

type Counts = ClientRow["counts"];

const emptyCounts = (): Counts => ({
  total: 0,
  in_negotiation: 0,
  in_production: 0,
  shipped: 0,
  delivered: 0,
  canceled: 0,
});

/**
 * Contagem de pedidos por cliente e status. O PostgREST não agrupa sem view/RPC
 * e devolve no máximo 1000 linhas por request, então a soma é feita aqui,
 * paginando as orders (~1.5k hoje). Se crescer, virar view materializada.
 */
async function loadOrderCounts(
  admin: ReturnType<typeof createAdminClient>
): Promise<Map<string, Counts>> {
  const counts = new Map<string, Counts>();
  const PAGE = 1000;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("orders")
      .select("client_id, status")
      .is("deleted_at", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error || !data?.length) break;

    for (const order of data) {
      if (!order.client_id) continue;
      const entry = counts.get(order.client_id) ?? emptyCounts();
      entry.total += 1;
      if (COUNTED.includes(order.status)) {
        entry[order.status as keyof Omit<Counts, "total">] += 1;
      }
      counts.set(order.client_id, entry);
    }

    if (data.length < PAGE) break;
  }

  return counts;
}

export default async function ClientsPage() {
  await verifySession();

  const admin = createAdminClient();
  const [clientsRes, countriesRes, counts] = await Promise.all([
    admin
      .from("clients")
      .select("id, name, country_id")
      .is("deleted_at", null)
      .order("name"),
    admin.from("countries").select("id, name").is("deleted_at", null).order("name"),
    loadOrderCounts(admin),
  ]);

  const countries = countriesRes.data ?? [];
  const countryName = new Map(countries.map((c) => [c.id, c.name]));

  const rows: ClientRow[] = (clientsRes.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    country_id: c.country_id,
    country_name: c.country_id ? countryName.get(c.country_id) ?? null : null,
    counts: counts.get(c.id) ?? emptyCounts(),
  }));

  return <ClientsClient data={rows} countries={countries} />;
}
