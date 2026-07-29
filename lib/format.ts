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

/** Timestamp completo (dd/mm/yyyy hh:mm) — usado em logs/histórico. Fuso America/Sao_Paulo. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const datePart = dateFormatter.format(date);
  const timePart = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TIME_ZONE,
  }).format(date);
  return `${datePart} ${timePart}`;
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
