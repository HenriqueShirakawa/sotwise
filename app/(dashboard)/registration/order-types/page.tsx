import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import { SimpleRegistrationCrud } from "@/components/registration/simple-crud";

import { createOrderTypes, updateOrderType, deleteOrderType } from "./actions";

export default async function OrderTypesPage() {
  await requireFeature("registration");
  const admin = createAdminClient();
  // Paginado: a lista inteira vai pro cliente, que pagina — sem isto o cadastro
  // pararia de crescer aos olhos do usuário no registro 1000 (ver lib/fetch-all).
  const data = await fetchAll<{ id: string; name: string }>((from, to) =>
    admin
      .from("order_types")
      .select("id, name")
      .is("deleted_at", null)
      .order("name")
      .range(from, to)
  );

  return (
    <SimpleRegistrationCrud
      data={data}
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
