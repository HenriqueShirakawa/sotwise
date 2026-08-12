import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import { PageHeader } from "@/components/page-header";

import { FactoriesClient } from "./factories-client";

export default async function FactoriesPage() {
  await requireFeature("registration");

  const admin = createAdminClient();
  // A paginação da tela é feita no cliente, sobre a lista inteira — sem o
  // fetchAll o cadastro pararia de crescer aos olhos do usuário no registro
  // 1000 (ver lib/fetch-all).
  const data = await fetchAll<{ id: string; name: string; created_at: string }>((from, to) =>
    admin
      .from("factories")
      .select("id, name, created_at")
      .is("deleted_at", null)
      .order("name")
      .range(from, to)
  );

  return (
    <div>
      <PageHeader
        title="Factories"
        description="Manufacturing sites available to orders."
      />
      <FactoriesClient data={data} />
    </div>
  );
}
