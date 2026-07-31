import { verifySession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { SimpleRegistrationCrud } from "@/components/registration/simple-crud";

import { createPols, updatePol, deletePol } from "./actions";

export default async function PolsPage() {
  await verifySession();
  const admin = createAdminClient();
  const { data } = await admin
    .from("pols")
    .select("id, name")
    .is("deleted_at", null)
    .order("name");

  return (
    <SimpleRegistrationCrud
      data={data ?? []}
      title="POL"
      subtitle="Manage the ports of loading"
      singular="POL"
      columnLabel="POL"
      searchPlaceholder="POL name"
      createLabel="Create POL"
      createAction={createPols}
      updateAction={updatePol}
      deleteAction={deletePol}
    />
  );
}
