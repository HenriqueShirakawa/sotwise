import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";

import { FactoriesClient } from "./factories-client";

export default async function FactoriesPage() {
  await requireFeature("registration");

  const admin = createAdminClient();
  const { data } = await admin
    .from("factories")
    .select("id, name, created_at")
    .is("deleted_at", null)
    .order("name");

  return (
    <div>
      <PageHeader
        title="Factories"
        description="Manufacturing sites available to orders."
      />
      <FactoriesClient data={data ?? []} />
    </div>
  );
}
