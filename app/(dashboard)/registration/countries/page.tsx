import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import { SimpleRegistrationCrud } from "@/components/registration/simple-crud";

import { createCountries, updateCountry, deleteCountry } from "./actions";

export const metadata = { title: "Countries" };

export default async function CountriesPage() {
  await requireFeature("registration");
  const admin = createAdminClient();
  // Paginado: a lista inteira vai pro cliente, que pagina — sem isto o cadastro
  // pararia de crescer aos olhos do usuário no registro 1000 (ver lib/fetch-all).
  // `iso_code` é espelho do GSS (migration 20261014120000) — exibido, não
  // editável: o sync o reescreve no próximo pull.
  const data = await fetchAll<{ id: string; name: string; iso_code: string | null }>((from, to) =>
    admin
      .from("countries")
      .select("id, name, iso_code")
      .is("deleted_at", null)
      .order("name")
      .range(from, to)
  );

  return (
    <SimpleRegistrationCrud
      data={data.map((c) => ({ id: c.id, name: c.name, extras: { iso_code: c.iso_code } }))}
      extraColumns={[{ key: "iso_code", label: "ISO code" }]}
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
