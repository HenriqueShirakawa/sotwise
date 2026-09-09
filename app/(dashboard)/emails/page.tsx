import { requireFeature } from "@/lib/dal";
import { loadEmailRecords } from "@/lib/checklist-emails-list-actions";

import { EmailsClient } from "./emails-client";

/**
 * Histórico de e-mails de checklist (Fase 2.1 — User Story 3), agrupado por
 * PO/PL — não "por pedido" ao pé da letra, porque um e-mail disparado de uma
 * etapa de Pre-loading/Shipment pode cobrir vários pedidos consolidados no
 * mesmo PL. Ver `lib/checklist-emails-list-actions.ts`.
 */
export const metadata = { title: "Emails" };

export default async function EmailsPage() {
  const { profile } = await requireFeature("email_history");
  const rows = await loadEmailRecords();

  return <EmailsClient rows={rows} company={profile.company} />;
}
