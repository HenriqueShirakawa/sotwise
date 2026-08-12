import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import { SimpleRegistrationCrud } from "@/components/registration/simple-crud";

import { createCarriers, updateCarrier, deleteCarrier } from "./actions";

export default async function CarriersPage() {
  await requireFeature("registration");
  const admin = createAdminClient();
  // Paginado: a lista inteira vai pro cliente, que pagina — sem isto o cadastro
  // pararia de crescer aos olhos do usuário no registro 1000 (ver lib/fetch-all).
  const data = await fetchAll<{ id: string; name: string }>((from, to) =>
    admin
      .from("carriers")
      .select("id, name")
      .is("deleted_at", null)
      .order("name")
      .range(from, to)
  );

  return (
    <SimpleRegistrationCrud
      data={data}
      title="Carriers"
      subtitle="View, manage, and create new carriers"
      singular="carrier"
      columnLabel="Carrier"
      searchPlaceholder="Carrier's name"
      createLabel="Create new carrier"
      createAction={createCarriers}
      updateAction={updateCarrier}
      deleteAction={deleteCarrier}
    />
  );
}
