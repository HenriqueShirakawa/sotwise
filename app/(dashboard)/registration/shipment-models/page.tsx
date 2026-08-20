import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import { SimpleRegistrationCrud } from "@/components/registration/simple-crud";

import {
  createShipmentModels,
  updateShipmentModel,
  deleteShipmentModel,
} from "./actions";

export const metadata = { title: "Shipment Models" };

export default async function ShipmentModelsPage() {
  await requireFeature("registration");
  const admin = createAdminClient();
  // Paginado: a lista inteira vai pro cliente, que pagina — sem isto o cadastro
  // pararia de crescer aos olhos do usuário no registro 1000 (ver lib/fetch-all).
  const data = await fetchAll<{ id: string; name: string }>((from, to) =>
    admin
      .from("shipment_models")
      .select("id, name")
      .is("deleted_at", null)
      .order("name")
      .range(from, to)
  );

  return (
    <SimpleRegistrationCrud
      data={data}
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
