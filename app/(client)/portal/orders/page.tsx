import type { Metadata } from "next";

import { loadClientOrders } from "@/domain/client/portal";
import { requireClientScope } from "@/lib/dal";

import { OrdersClient } from "./orders-client";

export const metadata: Metadata = { title: "My orders" };

export default async function PortalOrdersPage() {
  // Repetido no layout de propósito — layout não é guarda de rota no App
  // Router. O `clientId` daqui é o que filtra a query.
  const { clientId } = await requireClientScope();
  const orders = await loadClientOrders(clientId);

  return <OrdersClient orders={orders} />;
}
