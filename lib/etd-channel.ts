/**
 * Contrato do canal Realtime da tela ETD Factories — compartilhado entre quem
 * publica (servidor) e quem escuta (a lista no browser). Mesmo modelo das
 * mensagens/orders/shipments/pre-loading: um "ping" de broadcast avisa que algo
 * que a tela mostra mudou (ETD salvo, entrada Factory×Category criada/movida/
 * removida, lote mudou de status); o cliente reage com um refresh.
 */

/** Tópico do broadcast. Espelhado na RLS de `realtime.messages` (migration). */
export const ETD_TOPIC = "sotwise:etd";
export const ETD_EVENT = "etd";

export type EtdPing = {
  order_ids?: string[];
};
