import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { SimpleRegistrationCrud } from "@/components/registration/simple-crud";

import { createPods, updatePod, deletePod } from "./actions";

export default async function PodsPage() {
  await requireFeature("registration");
  const admin = createAdminClient();
  const { data } = await admin
    .from("pods")
    .select("id, name")
    .is("deleted_at", null)
    .order("name");

  return (
    <SimpleRegistrationCrud
      data={data ?? []}
      title="POD"
      subtitle="Manage the ports of discharge"
      singular="POD"
      columnLabel="POD"
      searchPlaceholder="POD name"
      createLabel="Create POD"
      createAction={createPods}
      updateAction={updatePod}
      deleteAction={deletePod}
    />
  );
}
