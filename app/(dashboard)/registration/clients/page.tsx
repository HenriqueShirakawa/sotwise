import { verifySession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";

import { ClientsClient } from "./clients-client";

export default async function ClientsPage() {
  await verifySession();

  const admin = createAdminClient();
  const [clientsRes, countriesRes] = await Promise.all([
    admin
      .from("clients")
      .select("id, name, country_id, created_at")
      .is("deleted_at", null)
      .order("name"),
    admin
      .from("countries")
      .select("id, name")
      .is("deleted_at", null)
      .order("name"),
  ]);

  const countries = countriesRes.data ?? [];
  const countryMap = new Map(countries.map((c) => [c.id, c.name]));

  const rows = (clientsRes.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    country_id: c.country_id,
    created_at: c.created_at,
    country_name: c.country_id ? countryMap.get(c.country_id) ?? null : null,
  }));

  return (
    <div>
      <PageHeader
        title="Clients"
        description="Companies that place orders in the system."
      />
      <ClientsClient data={rows} countries={countries} />
    </div>
  );
}
