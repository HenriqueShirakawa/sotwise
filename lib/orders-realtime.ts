import "server-only";

import { serverEnv } from "@/lib/env";
import {
  ORDERS_EVENT,
  ORDERS_TOPIC,
  type OrderStatusPing,
} from "@/lib/orders-channel";

/**
 * Avisa os clientes conectados que o status de uma ou mais Orders mudou. Vai
 * pela API REST do Realtime (não pelo WebSocket do supabase-js): numa função
 * serverless não há conexão para manter viva, e um POST resolve.
 *
 * Falha aqui NUNCA derruba a ação — o status já está gravado no banco e o
 * refetch normal (navegar/abrir a tela) pega o valor certo. Por isso o erro é
 * registrado e engolido. Mesmo modelo de `broadcastMessagePing`.
 */
export async function broadcastOrderStatusPing(ping: OrderStatusPing): Promise<void> {
  if (ping.order_ids.length === 0) return;
  try {
    const res = await fetch(`${serverEnv.supabaseUrl}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        apikey: serverEnv.supabaseServiceRoleKey,
        Authorization: `Bearer ${serverEnv.supabaseServiceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            topic: ORDERS_TOPIC,
            event: ORDERS_EVENT,
            payload: ping,
            private: true,
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error("[orders] broadcast falhou:", res.status, await res.text());
    }
  } catch (error) {
    console.error("[orders] broadcast falhou:", error);
  }
}
