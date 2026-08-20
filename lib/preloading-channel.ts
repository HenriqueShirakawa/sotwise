/**
 * Contrato do canal Realtime da lista de Pre-loading — compartilhado entre quem
 * publica (servidor) e quem escuta (a lista no browser). Mesmo modelo das
 * mensagens/orders/shipments: um "ping" de broadcast avisa que a lista mudou
 * (PL criado/editado/excluído, etapa salva, ou embarque confirmado — que tira o
 * PL da lista); o cliente reage com um refresh.
 */

export const PRELOADING_TOPIC = "sotwise:preloading";
export const PRELOADING_EVENT = "preloading";

export type PreLoadingPing = {
  ids?: string[];
};
