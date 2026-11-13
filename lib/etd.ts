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
 * Gap of Ready = hoje − Ready parts (a data real em que as peças ficaram
 * prontas, `ready_date` — 13/11/2026). Sem data, não há gap (linha antiga
 * marcada sem data fica vazia). `ready` acompanha a data em toda gravação.
 * Recalculado a cada leitura (nunca materializado no banco).
 *
 * Conta DIAS DE CALENDÁRIO (o dia de hoje em São Paulo − a data): antes
 * arredondava a diferença em horas e, depois do meio-dia UTC, somava um dia
 * a mais (pronto em 11/11, visto em 13/11 à tarde = 3 em vez de 2).
 */
export function gapOfReady(
  ready: boolean | null | undefined,
  readyDate: string | null | undefined,
  todayMs: number
): number | null {
  if (!ready || !readyDate) return null;
  const parsed = Date.parse(readyDate);
  if (Number.isNaN(parsed)) return null;
  const today = Date.parse(TODAY_FORMAT.format(new Date(todayMs)));
  return Math.round((today - parsed) / DAY_MS);
}

/** "YYYY-MM-DD" do instante em São Paulo — o mesmo fuso padrão de lib/format. */
const TODAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

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
