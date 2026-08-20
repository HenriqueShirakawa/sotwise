import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import { SimpleRegistrationCrud } from "@/components/registration/simple-crud";

import { createPols, updatePol, deletePol } from "./actions";

export const metadata = { title: "POL" };

export default async function PolsPage() {
  await requireFeature("registration");
  const admin = createAdminClient();
  // Paginado: a lista inteira vai pro cliente, que pagina — sem isto o cadastro
  // pararia de crescer aos olhos do usuário no registro 1000 (ver lib/fetch-all).
  const data = await fetchAll<{ id: string; name: string }>((from, to) =>
    admin
      .from("pols")
      .select("id, name")
      .is("deleted_at", null)
      .order("name")
      .range(from, to)
  );

  return (
    <SimpleRegistrationCrud
      data={data}
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
