import "server-only";

import { serverEnv } from "@/lib/env";
import {
  SHIPMENTS_EVENT,
  SHIPMENTS_TOPIC,
  type ShipmentPing,
} from "@/lib/shipments-channel";

/**
 * Avisa os clientes conectados que a lista de Shipments mudou (embarque criado,
 * etapa salva ou embarque excluído). Vai pela API REST do Realtime (não pelo
 * WebSocket): numa função serverless não há conexão para manter viva.
 *
 * Falha aqui NUNCA derruba a ação — o dado já está gravado e o refetch normal
 * pega o valor certo. Erro é registrado e engolido. Mesmo modelo do broadcast
 * das orders/mensagens.
 */
export async function broadcastShipmentPing(ping: ShipmentPing = {}): Promise<void> {
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
            topic: SHIPMENTS_TOPIC,
            event: SHIPMENTS_EVENT,
            payload: ping,
            private: true,
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error("[shipments] broadcast falhou:", res.status, await res.text());
    }
  } catch (error) {
    console.error("[shipments] broadcast falhou:", error);
  }
}
