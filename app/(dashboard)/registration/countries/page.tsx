import { verifySession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { SimpleRegistrationCrud } from "@/components/registration/simple-crud";

import { createCountries, updateCountry, deleteCountry } from "./actions";

export default async function CountriesPage() {
  await verifySession();
  const admin = createAdminClient();
  const { data } = await admin
    .from("countries")
    .select("id, name")
    .is("deleted_at", null)
    .order("name");

  return (
    <SimpleRegistrationCrud
      data={data ?? []}
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
