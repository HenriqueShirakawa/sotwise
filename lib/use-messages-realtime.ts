"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import {
  MESSAGES_EVENT,
  MESSAGES_TOPIC,
  type MessagePing,
} from "@/lib/messages-channel";
import { createClient } from "@/lib/supabase/client";

/* -------------------------------------------------------------------------- */
/* Canal único, compartilhado                                                  */
/* -------------------------------------------------------------------------- */

/**
 * O balão e o diálogo aberto escutam a mesma coisa ao mesmo tempo, e o servidor
 * (Phoenix) recusa dois joins no mesmo tópico pela mesma conexão. Por isso o
 * canal vive aqui, fora do React: um só, com N ouvintes, aberto no primeiro
 * componente que monta e fechado quando o último desmonta.
 */
type Listener = (ping: MessagePing) => void;

const listeners = new Set<Listener>();
const statusListeners = new Set<() => void>();

let channel: RealtimeChannel | null = null;
let connecting: Promise<void> | null = null;
let connected = false;

function publishStatus(next: boolean) {
  if (connected === next) return;
  connected = next;
  for (const l of statusListeners) l();
}

/** O status é estado de um sistema externo — o React o lê, não o guarda. */
function subscribeStatus(notify: () => void) {
  statusListeners.add(notify);
  return () => {
    statusListeners.delete(notify);
  };
}

function openChannel() {
  if (channel || connecting) return;

  const supabase = createClient();
  connecting = (async () => {
    try {
      // Canal privado só aceita cliente autenticado: manda o JWT da sessão
      // antes de entrar.
      await supabase.realtime.setAuth();

      // Todo mundo desmontou enquanto autenticávamos.
      if (!listeners.size) return;

      channel = supabase
        .channel(MESSAGES_TOPIC, { config: { private: true } })
        .on("broadcast", { event: MESSAGES_EVENT }, ({ payload }) => {
          for (const l of listeners) l(payload as MessagePing);
        })
        .subscribe((status, error) => {
          publishStatus(status === "SUBSCRIBED");
          if (error) console.error("[messages] canal realtime:", status, error);
        });
    } catch (error) {
      // Sem sessão válida não há canal — o polling assume sozinho.
      console.error("[messages] canal realtime:", error);
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
  publishStatus(false);
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Chama `onPing` no instante em que alguém envia uma mensagem — é o que a faz
 * aparecer sem recarregar a página e sem esperar o ciclo do polling.
 *
 * Devolve `true` enquanto o canal está conectado. Quem usa alarga o polling
 * nesse período e o retoma se a conexão cair (aba dormindo, rede oscilando,
 * política do canal ausente no banco): o Realtime acelera, mas nada depende
 * exclusivamente dele.
 *
 * `onPing` é lido por ref, então pode fechar sobre estado novo a cada render
 * sem mexer no canal.
 */
export function useMessagesRealtime(onPing: Listener): boolean {
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

  // `false` no servidor: sem canal no SSR, o polling entra no ciclo curto até o
  // browser conectar.
  return useSyncExternalStore(
    subscribeStatus,
    () => connected,
    () => false
  );
}
