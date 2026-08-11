import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { SimpleRegistrationCrud } from "@/components/registration/simple-crud";

import { createOrderTypes, updateOrderType, deleteOrderType } from "./actions";

export default async function OrderTypesPage() {
  await requireFeature("registration");
  const admin = createAdminClient();
  const { data } = await admin
    .from("order_types")
    .select("id, name")
    .is("deleted_at", null)
    .order("name");

  return (
    <SimpleRegistrationCrud
      data={data ?? []}
      title="Order Type"
      subtitle="View, manage, and create new order types"
      singular="order type"
      columnLabel="Order Type"
      searchPlaceholder="Order type name"
      createLabel="Create new order type"
      createAction={createOrderTypes}
      updateAction={updateOrderType}
      deleteAction={deleteOrderType}
    />
  );
}
