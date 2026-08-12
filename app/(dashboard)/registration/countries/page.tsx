import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import { SimpleRegistrationCrud } from "@/components/registration/simple-crud";

import { createCountries, updateCountry, deleteCountry } from "./actions";

export default async function CountriesPage() {
  await requireFeature("registration");
  const admin = createAdminClient();
  // Paginado: a lista inteira vai pro cliente, que pagina — sem isto o cadastro
  // pararia de crescer aos olhos do usuário no registro 1000 (ver lib/fetch-all).
  const data = await fetchAll<{ id: string; name: string }>((from, to) =>
    admin
      .from("countries")
      .select("id, name")
      .is("deleted_at", null)
      .order("name")
      .range(from, to)
  );

  return (
    <SimpleRegistrationCrud
      data={data}
      title="Countries"
      subtitle="View, manage, and create new countries"
      singular="country"
      columnLabel="Country"
      searchPlaceholder="Country name"
      createLabel="Create new country"
      createAction={createCountries}
      updateAction={updateCountry}
      deleteAction={deleteCountry}
    />
  );
}
