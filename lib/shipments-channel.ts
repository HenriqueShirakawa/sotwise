/**
 * Contrato do canal Realtime da lista de Shipments — compartilhado entre quem
 * publica (servidor) e quem escuta (a lista Shipments no browser). Mesmo modelo
 * das mensagens e das orders: um "ping" de broadcast avisa que a lista mudou
 * (embarque criado no Confirm Shipping, etapa salva, embarque excluído); o
 * cliente reage com um refresh. O dado real vem do refetch da página.
 */

/** Tópico do broadcast. Espelhado na RLS de `realtime.messages` (migration). */
export const SHIPMENTS_TOPIC = "sotwise:shipments";
export const SHIPMENTS_EVENT = "shipment";

export type ShipmentPing = {
  /** Ids afetados (opcional) — o cliente refaz o fetch da lista de qualquer forma. */
  ids?: string[];
};
