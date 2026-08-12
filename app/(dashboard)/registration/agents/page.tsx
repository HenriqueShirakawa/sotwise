import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";

import type { AgentLocation } from "@/types/database";

import { AgentsClient } from "./agents-client";

export default async function AgentsPage() {
  await requireFeature("registration");

  const admin = createAdminClient();
  // Tudo via fetchAll: a paginação da tela é no cliente, sobre a lista inteira,
  // e o vínculo agent_contacts cresce mais rápido que os dois cadastros que ele
  // liga — cortar no 1000 tiraria contatos de agentes (ver lib/fetch-all).
  const [agentsRes, countriesRes, contactsRes, linksRes] = await Promise.all([
    fetchAll<{
      id: string;
      name: string;
      country_id: string | null;
      location: AgentLocation | null;
      email: string | null;
      email_na: boolean;
      phone_number: string | null;
    }>((from, to) =>
      admin
        .from("agents")
        .select("id, name, country_id, location, email, email_na, phone_number")
        .is("deleted_at", null)
        .order("name")
        .range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin
        .from("countries")
        .select("id, name")
        .is("deleted_at", null)
        .order("name")
        .range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin
        .from("contacts")
        .select("id, name")
        .is("deleted_at", null)
        .order("name")
        .range(from, to)
    ),
    fetchAll<{ agent_id: string; contact_id: string }>((from, to) =>
      admin.from("agent_contacts").select("agent_id, contact_id").range(from, to)
    ),
  ]);

  const countries = countriesRes;
  /** A migração trouxe alguns contatos sem nome — viram linha em branco no
   * seletor e no vínculo do agente. Ficam de fora daqui (seguem existindo e
   * editáveis na tela de Contacts). */
  const contacts = contactsRes.filter((c) => c.name.trim());
  const countryName = new Map(countries.map((c) => [c.id, c.name]));
  const contactName = new Map(contacts.map((c) => [c.id, c.name]));

  /** Contatos por agente — a junção vem inteira e é agrupada aqui (lista pequena). */
  const contactsByAgent = new Map<string, string[]>();
  for (const link of linksRes) {
    if (!contactName.has(link.contact_id)) continue; // contato excluído
    const list = contactsByAgent.get(link.agent_id) ?? [];
    list.push(link.contact_id);
    contactsByAgent.set(link.agent_id, list);
  }

  const rows = agentsRes.map((a) => {
    const contactIds = contactsByAgent.get(a.id) ?? [];
    return {
      id: a.id,
      name: a.name,
      country_id: a.country_id,
      country_name: a.country_id ? countryName.get(a.country_id) ?? null : null,
      location: a.location,
      email: a.email,
      email_na: a.email_na,
      phone_number: a.phone_number,
      contact_ids: contactIds,
      contact_names: contactIds.map((id) => contactName.get(id) ?? ""),
    };
  });

  return <AgentsClient data={rows} countries={countries} contacts={contacts} />;
}
