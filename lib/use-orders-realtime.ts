"use client";

import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import {
  ORDERS_EVENT,
  ORDERS_TOPIC,
  type OrderStatusPing,
} from "@/lib/orders-channel";
import { createClient } from "@/lib/supabase/client";

/**
 * Canal Realtime do status das Orders. Vive fora do React (um só, N ouvintes)
 * pelo mesmo motivo do canal das mensagens: o servidor recusa dois joins no
 * mesmo tópico pela mesma conexão. Abre no primeiro `useOrdersRealtime` que
 * monta, fecha quando o último desmonta.
 */
type Listener = (ping: OrderStatusPing) => void;

const listeners = new Set<Listener>();

let channel: RealtimeChannel | null = null;
let connecting: Promise<void> | null = null;

function openChannel() {
  if (channel || connecting) return;

  const supabase = createClient();
  connecting = (async () => {
    try {
      // Canal privado só aceita cliente autenticado: manda o JWT da sessão.
      await supabase.realtime.setAuth();
      if (!listeners.size) return; // todos desmontaram enquanto autenticava

      channel = supabase
        .channel(ORDERS_TOPIC, { config: { private: true } })
        .on("broadcast", { event: ORDERS_EVENT }, ({ payload }) => {
          for (const l of listeners) l(payload as OrderStatusPing);
        })
        .subscribe((status, error) => {
          if (error) console.error("[orders] canal realtime:", status, error);
        });
    } catch (error) {
      // Sem sessão válida não há canal — a tela só não atualiza sozinha.
      console.error("[orders] canal realtime:", error);
    } finally {
      connecting = null;
    }
  })();
}

function closeChannelIfIdle() {
  if (listeners.size || !channel) return;
  const supabase = createClient();
  void supabase.removeChannel(channel);
  channel = null;
}

/**
 * Chama `onPing` quando o status de alguma Order muda (via rollup dos lotes) —
 * é o que faz o Status PO da lista atualizar sem F5, mesmo com a tela parada.
 * `onPing` é lido por ref: pode fechar sobre estado novo a cada render sem
 * reabrir o canal.
 */
export function useOrdersRealtime(onPing: Listener): void {
  const latest = useRef(onPing);
  useEffect(() => {
    latest.current = onPing;
  });

  useEffect(() => {
    const listener: Listener = (ping) => latest.current(ping);
    listeners.add(listener);
    openChannel();

    return () => {
      listeners.delete(listener);
      closeChannelIfIdle();
    };
  }, []);
}
