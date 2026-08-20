import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";

import { ExportersClient } from "./exporters-client";

export const metadata = { title: "Exporters" };

export default async function ExportersPage() {
  await requireFeature("registration");
  const admin = createAdminClient();

  const data = await fetchAll<{ id: string; name: string; acronym: string }>((from, to) =>
    admin
      .from("exporters")
      .select("id, name, acronym")
      .is("deleted_at", null)
      .order("name")
      .range(from, to)
  );

  return <ExportersClient data={data.filter((e) => e.name.trim())} />;
}
