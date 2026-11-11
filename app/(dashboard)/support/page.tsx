import {
  loadRepresentatives,
  loadSupportConversations,
  loadSupportThread,
} from "@/domain/support/chat";
import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";

import { SupportInbox } from "./support-inbox";

export const metadata = { title: "Support" };

/**
 * Support (05/11/2026): conversas do portal com os clientes — uma thread por
 * cliente. Lista à esquerda (quem eu represento + todo cliente que já
 * escreveu), thread do cliente escolhido (`?client=`) à direita.
 */
export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const session = await requireFeature("support");
  const { client } = await searchParams;

  const conversations = await loadSupportConversations(session.userId);

  // Cliente escolhido: o da URL (se existir) ou, sem escolha, nenhum — no
  // celular a lista ocupa a tela; no desktop o painel da direita orienta.
  let selected: { id: string; name: string } | null = null;
  if (client) {
    const known = conversations.find((c) => c.clientId === client);
    if (known) {
      selected = { id: known.clientId, name: known.clientName };
    } else {
      const { data } = await createAdminClient()
        .from("clients")
        .select("id, name")
        .eq("id", client)
        .is("deleted_at", null)
        .maybeSingle();
      if (data) selected = { id: data.id, name: data.name };
    }
  }

  const [messages, representatives] = selected
    ? await Promise.all([loadSupportThread(selected.id), loadRepresentatives(selected.id)])
    : [[], []];

  return (
    <SupportInbox
      viewerId={session.userId}
      conversations={conversations}
      selected={selected}
      messages={messages}
      representatives={representatives}
      canReply={session.permissions.support.create}
    />
  );
}
