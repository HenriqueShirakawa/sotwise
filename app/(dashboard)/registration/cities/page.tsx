import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import { SimpleRegistrationCrud } from "@/components/registration/simple-crud";

import { createCities, updateCity, deleteCity } from "./actions";

/**
 * Cidades — cadastro name-only, como POL/POD/Countries.
 *
 * O vínculo `city_pols` NÃO é editável aqui, e isso é deliberado: hoje ele só é
 * LIDO (o detalhe do Pre-loading usa a cidade para distinguir dois POLs de mesmo
 * nome) e a tabela é uma das 14 bibliotecas que o GSS passa a ser dono. Abrir
 * escrita do vínculo por esta tela criaria um segundo dono do mesmo dado às
 * vésperas de a integração assumi-lo. Ver docs/INTEGRACAO_GSS.md §3.
 */
export const metadata = { title: "Cities" };

export default async function CitiesPage() {
  await requireFeature("registration");
  const admin = createAdminClient();
  // Paginado: 652 cidades hoje, e a lista inteira vai pro cliente, que pagina
  // (ver lib/fetch-all).
  // `province`/`country` são espelho do GSS, em texto (migration
  // 20261014120000). São eles que distinguem as homônimas — "Santa Maria" do RS
  // da "Santa Maria" do RN —, então entram como coluna e na busca.
  const data = await fetchAll<{
    id: string;
    name: string;
    province: string | null;
    country: string | null;
  }>((from, to) =>
    admin
      .from("cities")
      .select("id, name, province, country")
      .is("deleted_at", null)
      .order("name")
      .range(from, to)
  );

  return (
    <SimpleRegistrationCrud
      data={data
        .filter((c) => c.name.trim())
        .map((c) => ({
          id: c.id,
          name: c.name,
          extras: { province: c.province, country: c.country },
        }))}
      extraColumns={[
        { key: "province", label: "Province" },
        { key: "country", label: "Country" },
      ]}
      title="Cities"
      subtitle="Manage the cities used by ports and factories"
      singular="city"
      columnLabel="City"
      searchPlaceholder="City name"
      createLabel="Create city"
      createAction={createCities}
      updateAction={updateCity}
      deleteAction={deleteCity}
    />
  );
}
