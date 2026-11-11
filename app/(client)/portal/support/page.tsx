import type { Metadata } from "next";

import { resolvePortalLocale } from "@/domain/client/locale";
import { loadRepresentatives, loadSupportThread } from "@/domain/support/chat";
import { requireClientScope } from "@/lib/dal";
import { portalMessages } from "@/lib/portal-i18n";

import { SupportClient } from "./support-client";

export async function generateMetadata(): Promise<Metadata> {
  return { title: portalMessages(await resolvePortalLocale()).nav.support };
}

/**
 * Suporte do portal (bloco F, 05/11/2026): os contatos da AGK que representam
 * este cliente (marcados em Registration > Clients) + um chat único com eles.
 * Thread e contatos escopados pelo `clientId` da sessão.
 */
export default async function PortalSupportPage() {
  const { session, clientId } = await requireClientScope();
  const [representatives, messages] = await Promise.all([
    loadRepresentatives(clientId),
    loadSupportThread(clientId),
  ]);

  return (
    <SupportClient
      viewerId={session.userId}
      representatives={representatives}
      messages={messages}
    />
  );
}
