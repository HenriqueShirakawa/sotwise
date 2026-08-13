import type { MessageEntity } from "@/types/database";

/**
 * Contrato do canal Realtime das mensagens — o único arquivo compartilhado
 * entre quem publica (servidor) e quem escuta (browser).
 */

/** Tópico do broadcast. Espelhado na RLS de `realtime.messages` (migration). */
export const MESSAGES_TOPIC = "sotwise:messages";
export const MESSAGES_EVENT = "message";

/**
 * O que trafega no canal. Só ids: o conteúdo da mensagem continua saindo do
 * servidor, pela mesma action de sempre, depois que o cliente é avisado.
 */
export type MessagePing = {
  message_id: string;
  entity_type: MessageEntity;
  entity_id: string;
  author_id: string;
  /** Quem foi marcado no "Forward to" — quem tem o contador afetado. */
  recipient_ids: string[];
};

/**
 * Polling: continua existindo como rede de segurança. Com o canal conectado o
 * ciclo é longo (o aviso vem pelo Realtime); se a conexão cai, volta ao ciclo
 * curto e o comportamento degrada para o que era antes, sem quebrar.
 */
export const MESSAGES_POLL_MS = 15_000;
export const MESSAGES_POLL_LIVE_MS = 60_000;
