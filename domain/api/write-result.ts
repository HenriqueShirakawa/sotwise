/**
 * Resultado das escritas da API de integração (domain/<recurso>/api-write.ts).
 * O status já é o HTTP que a rota devolve — a rota só traduz em Response
 * (lib/api-route.ts → `respond`).
 */

export type WriteResult<T> =
  | { ok: true; status: 200 | 201; data: T }
  | { ok: false; status: 400 | 404 | 409 | 500; error: string };

export type Fail = Extract<WriteResult<never>, { ok: false }>;

export const fail = (status: Fail["status"], error: string): Fail => ({ ok: false, status, error });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
