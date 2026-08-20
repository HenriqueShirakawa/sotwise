/**
 * Contrato do canal Realtime do status das Orders — compartilhado entre quem
 * publica (servidor, no `syncOrderStatus`) e quem escuta (a lista Orders no
 * browser). Mesmo modelo das mensagens: um "ping" de broadcast avisa que algo
 * mudou; o cliente reage com um refresh. O payload não carrega o status novo —
 * só os ids que mudaram —, o dado real vem do refetch da página.
 */

/** Tópico do broadcast. Espelhado na RLS de `realtime.messages` (migration). */
export const ORDERS_TOPIC = "sotwise:orders";
export const ORDERS_EVENT = "order-status";

export type OrderStatusPing = {
  /** Orders cujo status acabou de mudar (rollup dos lotes). */
  order_ids: string[];
};
