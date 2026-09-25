import "server-only";

import { serverEnv } from "@/lib/env";
import { ETD_EVENT, ETD_TOPIC, type EtdPing } from "@/lib/etd-channel";

/**
 * Avisa os clientes com a tela ETD Factories aberta que ela mudou. Pela API
 * REST do Realtime (não pelo WebSocket) — serverless não mantém conexão. Falha
 * NUNCA derruba a ação: o dado já está gravado e o refetch normal corrige.
 * Mesmo modelo do broadcast das orders/shipments/pre-loading.
 */
export async function broadcastEtdPing(ping: EtdPing = {}): Promise<void> {
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
            topic: ETD_TOPIC,
            event: ETD_EVENT,
            payload: ping,
            private: true,
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error("[etd] broadcast falhou:", res.status, await res.text());
    }
  } catch (error) {
    console.error("[etd] broadcast falhou:", error);
  }
}
