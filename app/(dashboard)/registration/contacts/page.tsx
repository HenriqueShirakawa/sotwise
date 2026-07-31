import { verifySession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";

import { ContactsClient } from "./contacts-client";

export default async function ContactsPage() {
  await verifySession();

  const admin = createAdminClient();
  const { data } = await admin
    .from("contacts")
    .select("id, name, email, email_na, phone_number")
    .is("deleted_at", null)
    .order("name");

  return <ContactsClient data={data ?? []} />;
}
