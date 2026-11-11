const TIME_ZONE = "America/Sao_Paulo";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: TIME_ZONE,
});

/** Formata um timestamp/date do Postgres como dd/mm/yyyy. Fuso America/Sao_Paulo. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return dateFormatter.format(date);
}

/** Datas de campos `date` do Postgres, sem conversão de fuso horário. */
export function formatDateNumeric(value: string | null | undefined): string {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: TIME_ZONE,
  }).format(date);
}

/**
 * Timestamp completo (dd/mm/yyyy hh:mm) — usado em logs/histórico. Fuso
 * America/Sao_Paulo por padrão; `timeZone` é usado só onde a tela precisa de
 * outro fuso (ex.: `/emails`, pela company do usuário — ver `companyTimeZone`).
 * Todo o resto do app continua com o mesmo fuso fixo de sempre.
 */
export function formatDateTime(value: string | null | undefined, timeZone: string = TIME_ZONE): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const datePart =
    timeZone === TIME_ZONE
      ? dateFormatter.format(date)
      : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone }).format(
          date
        );
  const timePart = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(date);
  return `${datePart} ${timePart}`;
}

/**
 * Fuso da company do usuário logado — usado só pelo histórico de e-mails
 * (`/emails`, Fase 2.1 US3 RN02). BR opera em São Paulo; China em Shanghai
 * (UTC+8, sem horário de verão).
 */
export function companyTimeZone(company: "BR" | "China"): string {
  return company === "China" ? "Asia/Shanghai" : TIME_ZONE;
}

/** Fuso padrão da operação — vale quando não se sabe o fuso de quem usa. */
export const OPERATION_TIME_ZONE = TIME_ZONE;

/** O fuso existe (IANA, ex.: "Asia/Shanghai")? */
export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Fuso do computador de quem usa (só no navegador; no servidor, undefined). */
export function browserTimeZone(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isValidTimeZone(tz) ? tz : undefined;
}

/**
 * Hoje como "YYYY-MM-DD" — a mesma forma dos campos `date` do Postgres.
 *
 * Desde 11/11/2026 (card da call de 10/11, item 5 — a equipe da China não
 * conseguia lançar o dia 11 porque no Brasil ainda era 10): o "hoje" é o do
 * FUSO DO COMPUTADOR de quem usa, como no GSS. No navegador, sem argumento, vale
 * o fuso do próprio navegador; no servidor, passe o fuso do usuário
 * (`userTodayIso()` em lib/user-time-zone lê o cookie que o navegador grava).
 * Sem fuso conhecido (ex.: chamada do GSS pela API), vale São Paulo.
 */
export function todayIso(timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: isValidTimeZone(timeZone) ? timeZone : (browserTimeZone() ?? TIME_ZONE),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** BU vem do banco como "Moto Parts", "Auto Parts"… a UI mostra só "Moto", "Auto". */
export function displayBu(name: string): string {
  return name.replace(/\s*parts$/i, "");
}

/** Moeda BRL (para uso futuro nos módulos transacionais). */
export const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
