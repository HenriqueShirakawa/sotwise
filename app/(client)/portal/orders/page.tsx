import type { Metadata } from "next";

import { resolvePortalLocale } from "@/domain/client/locale";
import { loadClientOrders } from "@/domain/client/portal";
import { requireClientScope } from "@/lib/dal";
import { portalMessages } from "@/lib/portal-i18n";

import { OrdersClient } from "./orders-client";

export async function generateMetadata(): Promise<Metadata> {
  return { title: portalMessages(await resolvePortalLocale()).nav.myOrders };
}

export default async function PortalOrdersPage() {
  // Repetido no layout de propósito — layout não é guarda de rota no App
  // Router. O `clientId` daqui é o que filtra a query.
  const { clientId } = await requireClientScope();
  const orders = await loadClientOrders(clientId);

  return <OrdersClient orders={orders} />;
}
