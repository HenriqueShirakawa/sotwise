/**
 * Campos calculados da ETD (docs/regras_de_negocio.md §3.7.4). Vivem aqui, e
 * não na página, porque a rua ETD Factories e o copilot precisam responder o
 * mesmo número — se cada um tivesse a sua conta, a resposta do copilot
 * divergiria da tela e ninguém saberia qual acreditar.
 */

const DAY_MS = 86_400_000;

/**
 * Days Delay = |current_date − initial_date|.
 *
 * O módulo é regra de negócio, não descuido: quando a ETD é ANTECIPADA o cru dá
 * negativo (26 linhas em produção, de -1 a -109 dias) e o cliente confirmou que
 * o desvio conta pelos dois lados — a coluna nunca mostra número negativo.
 */
export function daysDelay(
  initialDate: string | null,
  currentDate: string | null
): number | null {
  if (!initialDate || !currentDate) return null;
  const a = Date.parse(initialDate);
  const b = Date.parse(currentDate);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.abs(Math.round((b - a) / DAY_MS));
}

/**
 * Gap of Ready = hoje − ready_date. Só faz sentido nas linhas com `ready`
 * marcado; recalculado a cada leitura (nunca materializado no banco).
 */
export function gapOfReady(
  ready: boolean | null | undefined,
  readyDate: string | null | undefined,
  todayMs: number
): number | null {
  if (!ready || !readyDate) return null;
  const parsed = Date.parse(readyDate);
  if (Number.isNaN(parsed)) return null;
  return Math.round((todayMs - parsed) / DAY_MS);
}

/**
 * "Atrasado" na ETD = Days Delay > 0 (confirmado com o cliente em 13/08/2026,
 * ver §6.1). Entrada sem uma das datas não conta como atrasada — conta como
 * desconhecida.
 */
export function isEtdLate(
  initialDate: string | null,
  currentDate: string | null
): boolean {
  const delay = daysDelay(initialDate, currentDate);
  return delay !== null && delay > 0;
}
