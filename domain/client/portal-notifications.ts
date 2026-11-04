import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { BatchStatus, OrderStatus } from "@/types/database";

/**
 * Sino do portal (Portal v2, bloco E). Reaproveita a outbox da 2.1
 * (`client_notifications`): cada linha é um avanço de lote que o trigger já
 * registrou — a mesma fonte dos e-mails, então o sino e o e-mail nunca
 * discordam. Aparece mesmo que o e-mail tenha falhado: o fato (o lote andou)
 * aconteceu.
 *
 * "Lida" é por USUÁRIO e fica em `profiles.ui_preferences.portal_notifications`
 * (sem tabela nova):
 *  - `seen_before`: tudo criado até esse instante conta como lido ("marcar
 *    todas"). Sem valor, vale a criação do usuário — quem acabou de ganhar acesso
 *    não começa com o histórico inteiro aceso;
 *  - `read`: ids lidos um a um depois disso (limitado a READ_CAP).
 */

export const PORTAL_NOTIF_PREF = "portal_notifications";
export const READ_CAP = 200;
const LIST_LIMIT = 20;

export type NotifPrefs = { seen_before?: string; read?: string[] };

export type PortalNotification = {
  id: string;
  orderId: string;
  poNumber: string;
  batchCode: string;
  toStatus: BatchStatus;
  createdAt: string;
  unread: boolean;
};

export function readNotifPrefs(uiPreferences: unknown): NotifPrefs {
  const raw = (uiPreferences as Record<string, unknown> | null)?.[PORTAL_NOTIF_PREF];
  if (!raw || typeof raw !== "object") return {};
  const p = raw as Record<string, unknown>;
  return {
    seen_before: typeof p.seen_before === "string" ? p.seen_before : undefined,
    read: Array.isArray(p.read) ? p.read.filter((x): x is string => typeof x === "string") : [],
  };
}

/**
 * Últimos avanços de lote do cliente, mais recente primeiro. O `clientId` vem
 * de `requireClientScope()` e filtra a outbox E o pedido (`orders!inner`) —
 * a mesma regra de escopo do resto do portal. Pedido apagado ou em negociação
 * não aparece (some das outras telas também).
 */
export async function loadPortalNotifications(
  clientId: string,
  prefs: NotifPrefs,
  userCreatedAt: string
): Promise<PortalNotification[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("client_notifications")
    .select(
      "id, order_id, to_status, created_at, batches(batch_number), orders!inner(po_number, status, client_id, deleted_at)"
    )
    .eq("client_id", clientId)
    .eq("orders.client_id", clientId)
    .is("orders.deleted_at", null)
    .neq("orders.status", "in_negotiation")
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT)
    .returns<
      {
        id: string;
        order_id: string;
        to_status: BatchStatus;
        created_at: string;
        batches: { batch_number: string } | null;
        orders: { po_number: string; status: OrderStatus };
      }[]
    >();

  // Por Date.parse, não por texto: o Postgres devolve "+00:00" e o JS grava "Z".
  const seenBefore = Date.parse(prefs.seen_before ?? userCreatedAt) || 0;
  const read = new Set(prefs.read ?? []);

  return (data ?? []).map((n) => ({
    id: n.id,
    orderId: n.order_id,
    poNumber: n.orders.po_number,
    batchCode: n.batches?.batch_number ?? "",
    toStatus: n.to_status,
    createdAt: n.created_at,
    unread: Date.parse(n.created_at) > seenBefore && !read.has(n.id),
  }));
}
