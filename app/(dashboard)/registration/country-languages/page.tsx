import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import {
  CountryLanguageTable,
  type CountryLanguageRow,
} from "@/components/registration/country-language-table";

import { setCountryLanguageDefault } from "./actions";

export const metadata = { title: "Country Languages" };

export default async function CountryLanguagesPage() {
  await requireFeature("registration");
  const admin = createAdminClient();

  const countries = await fetchAll<{ id: string; name: string }>((from, to) =>
    admin
      .from("countries")
      .select("id, name")
      .is("deleted_at", null)
      .order("name")
      .range(from, to)
  );

  const { data: defaults } = await admin
    .from("country_language_defaults")
    .select("country_id, language");

  const languageByCountry = new Map((defaults ?? []).map((d) => [d.country_id, d.language]));

  const rows: CountryLanguageRow[] = countries.map((c) => ({
    id: c.id,
    name: c.name,
    language: languageByCountry.get(c.id) ?? null,
  }));

  return <CountryLanguageTable data={rows} updateAction={setCountryLanguageDefault} />;
}
