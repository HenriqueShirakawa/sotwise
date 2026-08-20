import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import { SimpleRegistrationCrud } from "@/components/registration/simple-crud";

import { createPods, updatePod, deletePod } from "./actions";

export const metadata = { title: "POD" };

export default async function PodsPage() {
  await requireFeature("registration");
  const admin = createAdminClient();
  // Paginado: a lista inteira vai pro cliente, que pagina — sem isto o cadastro
  // pararia de crescer aos olhos do usuário no registro 1000 (ver lib/fetch-all).
  const data = await fetchAll<{ id: string; name: string }>((from, to) =>
    admin
      .from("pods")
      .select("id, name")
      .is("deleted_at", null)
      .order("name")
      .range(from, to)
  );

  return (
    <SimpleRegistrationCrud
      data={data}
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
