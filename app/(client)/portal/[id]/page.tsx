import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { loadClientOrderDetail } from "@/domain/client/portal";
import { requireClientScope } from "@/lib/dal";

import { PortalOrderDetail } from "./order-detail-client";

export const metadata: Metadata = { title: "Order" };

export default async function PortalOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Guarda repetida (não no layout) — ver o comentário no layout do grupo. O
  // `clientId` daqui é o que garante que o pedido da URL é mesmo deste cliente.
  const { clientId } = await requireClientScope();
  const { id } = await params;

  const order = await loadClientOrderDetail(clientId, id);
  // Pedido inexistente, apagado, escondido do cliente ou de OUTRO cliente: tudo
  // cai aqui igual, para não vazar "existe mas não é seu" via 403 vs 404.
  if (!order) notFound();

  return <PortalOrderDetail order={order} />;
}
