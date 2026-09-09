/**
 * Detecta se um segmento de URL é o UUID interno (link antigo) em vez do
 * slug bonito (po_number/pl_number) — decide o lookup nas páginas de detalhe
 * de Order/Pre-loading/Shipment. Sem `server-only`: roda tanto em Server
 * Component quanto no client (`message-fab.tsx`).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
