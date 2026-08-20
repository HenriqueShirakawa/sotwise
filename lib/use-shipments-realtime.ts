"use client";

import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import {
  SHIPMENTS_EVENT,
  SHIPMENTS_TOPIC,
  type ShipmentPing,
} from "@/lib/shipments-channel";
import { createClient } from "@/lib/supabase/client";

/**
 * Canal Realtime da lista de Shipments. Vive fora do React (um só, N ouvintes)
 * pelo mesmo motivo do canal das mensagens/orders. Abre no primeiro
 * `useShipmentsRealtime` que monta, fecha quando o último desmonta.
 */
type Listener = (ping: ShipmentPing) => void;

const listeners = new Set<Listener>();

let channel: RealtimeChannel | null = null;
let connecting: Promise<void> | null = null;

function openChannel() {
  if (channel || connecting) return;

  const supabase = createClient();
  connecting = (async () => {
    try {
      await supabase.realtime.setAuth(); // canal privado exige o JWT da sessão
      if (!listeners.size) return; // todos desmontaram enquanto autenticava

      channel = supabase
        .channel(SHIPMENTS_TOPIC, { config: { private: true } })
        .on("broadcast", { event: SHIPMENTS_EVENT }, ({ payload }) => {
          for (const l of listeners) l(payload as ShipmentPing);
        })
        .subscribe((status, error) => {
          if (error) console.error("[shipments] canal realtime:", status, error);
        });
    } catch (error) {
      console.error("[shipments] canal realtime:", error);
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
 * Chama `onPing` quando a lista de Shipments muda (embarque criado/alterado/
 * excluído) — faz a lista atualizar sem F5, mesmo com a tela parada. `onPing`
 * é lido por ref: fecha sobre estado novo a cada render sem reabrir o canal.
 */
export function useShipmentsRealtime(onPing: Listener): void {
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
