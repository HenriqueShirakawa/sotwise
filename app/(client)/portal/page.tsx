import type { Metadata } from "next";

import { loadClientOrders } from "@/domain/client/portal";
import { requireClientScope } from "@/lib/dal";

import { PortalClient } from "./portal-client";

export const metadata: Metadata = { title: "My orders" };

export default async function PortalPage() {
  // Repetido no layout de propósito — ver o comentário lá: layout não é guarda
  // de rota no App Router. O `clientId` daqui é o que filtra a query.
  const { clientId } = await requireClientScope();
  const orders = await loadClientOrders(clientId);

  return <PortalClient orders={orders} />;
}
