import "server-only";

import { serverEnv } from "@/lib/env";
import {
  PRELOADING_EVENT,
  PRELOADING_TOPIC,
  type PreLoadingPing,
} from "@/lib/preloading-channel";

/**
 * Avisa os clientes com a lista de Pre-loading aberta que ela mudou. Pela API
 * REST do Realtime (não pelo WebSocket) — serverless não mantém conexão. Falha
 * NUNCA derruba a ação: o dado já está gravado e o refetch normal corrige.
 * Mesmo modelo do broadcast das orders/shipments.
 */
export async function broadcastPreLoadingPing(ping: PreLoadingPing = {}): Promise<void> {
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
            topic: PRELOADING_TOPIC,
            event: PRELOADING_EVENT,
            payload: ping,
            private: true,
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error("[pre-loading] broadcast falhou:", res.status, await res.text());
    }
  } catch (error) {
    console.error("[pre-loading] broadcast falhou:", error);
  }
}
