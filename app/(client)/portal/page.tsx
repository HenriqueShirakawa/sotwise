import type { Metadata } from "next";

import { resolvePortalLocale } from "@/domain/client/locale";
import { buildClientDashboard, loadClientOrders } from "@/domain/client/portal";
import { requireClientScope } from "@/lib/dal";
import { portalMessages } from "@/lib/portal-i18n";

import { DashboardClient } from "./dashboard-client";

export async function generateMetadata(): Promise<Metadata> {
  return { title: portalMessages(await resolvePortalLocale()).nav.dashboard };
}

/**
 * Dashboard do portal: pedidos ativos, próxima entrega, pedidos com ETA ao
 * Brasil vencida e os mais recentes em andamento. Tudo sai da mesma leitura de
 * "My orders" (`buildClientDashboard`) — sem fornecedor nem valor, que dependem
 * de decisão (bloco G do card).
 */
export default async function PortalDashboardPage() {
  // Guarda repetida (não só no layout) — ver o comentário em layout.tsx.
  const { session, clientId } = await requireClientScope();
  const orders = await loadClientOrders(clientId);
  const firstName = session.profile.full_name.split(" ").filter(Boolean)[0] ?? "";

  return <DashboardClient dashboard={buildClientDashboard(orders)} firstName={firstName} />;
}
