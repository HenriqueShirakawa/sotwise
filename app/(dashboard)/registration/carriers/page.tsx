import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { SimpleRegistrationCrud } from "@/components/registration/simple-crud";

import { createCarriers, updateCarrier, deleteCarrier } from "./actions";

export default async function CarriersPage() {
  await requireFeature("registration");
  const admin = createAdminClient();
  const { data } = await admin
    .from("carriers")
    .select("id, name")
    .is("deleted_at", null)
    .order("name");

  return (
    <SimpleRegistrationCrud
      data={data ?? []}
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
