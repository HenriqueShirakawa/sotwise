import { verifySession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { SimpleRegistrationCrud } from "@/components/registration/simple-crud";

import {
  createShipmentModels,
  updateShipmentModel,
  deleteShipmentModel,
} from "./actions";

export default async function ShipmentModelsPage() {
  await verifySession();
  const admin = createAdminClient();
  const { data } = await admin
    .from("shipment_models")
    .select("id, name")
    .is("deleted_at", null)
    .order("name");

  return (
    <SimpleRegistrationCrud
      data={data ?? []}
      title="Shipment Models"
      subtitle="View, manage, and create new shipment models"
      singular="shipment model"
      columnLabel="Shipment Model"
      searchPlaceholder="Shipment model name"
      createLabel="Create new shipment model"
      createAction={createShipmentModels}
      updateAction={updateShipmentModel}
      deleteAction={deleteShipmentModel}
    />
  );
}
