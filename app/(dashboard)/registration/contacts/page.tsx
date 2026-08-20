import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";

import { ContactsClient, type ContactRow } from "./contacts-client";

export const metadata = { title: "Contacts" };

export default async function ContactsPage() {
  await requireFeature("registration");

  const admin = createAdminClient();
  // Paginado: a lista inteira vai pro cliente, que pagina — sem isto o cadastro
  // pararia de crescer aos olhos do usuário no registro 1000 (ver lib/fetch-all).
  const data = await fetchAll<ContactRow>((from, to) =>
    admin
      .from("contacts")
      .select("id, name, email, email_na, phone_number")
      .is("deleted_at", null)
      .order("name")
      .range(from, to)
  );

  return <ContactsClient data={data} />;
}
