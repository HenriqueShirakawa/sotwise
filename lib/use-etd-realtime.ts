"use client";

import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { ETD_EVENT, ETD_TOPIC, type EtdPing } from "@/lib/etd-channel";
import { createClient } from "@/lib/supabase/client";

/**
 * Canal Realtime da tela ETD Factories. Vive fora do React (um só, N
 * ouvintes) pelo mesmo motivo dos outros canais. Abre no primeiro
 * `useEtdRealtime` que monta, fecha quando o último desmonta.
 */
type Listener = (ping: EtdPing) => void;

const listeners = new Set<Listener>();

let channel: RealtimeChannel | null = null;
let connecting: Promise<void> | null = null;

function openChannel() {
  if (channel || connecting) return;

  const supabase = createClient();
  connecting = (async () => {
    try {
      await supabase.realtime.setAuth();
      if (!listeners.size) return;

      channel = supabase
        .channel(ETD_TOPIC, { config: { private: true } })
        .on("broadcast", { event: ETD_EVENT }, ({ payload }) => {
          for (const l of listeners) l(payload as EtdPing);
        })
        .subscribe((status, error) => {
          if (error) console.error("[etd] canal realtime:", status, error);
        });
    } catch (error) {
      console.error("[etd] canal realtime:", error);
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
 * Chama `onPing` quando algo da tela ETD Factories muda — faz a lista atualizar sem
 * F5, mesmo com a tela parada. `onPing` é lido por ref.
 */
export function useEtdRealtime(onPing: Listener): void {
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
