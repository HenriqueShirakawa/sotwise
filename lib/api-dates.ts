import { z } from "zod";

/**
 * Datas da API de integração em UNIX (segundos) — decisão do usuário,
 * 06/10/2026: a API fala o mesmo formato do GSS, na entrada e na saída.
 *
 *  - DIA (coluna `date`, ex.: ship_requirement, etapas do checklist) → Unix às
 *    12:00 UTC. Meio-dia UTC cai no mesmo dia no Brasil (UTC-3) e na China
 *    (UTC+8); meia-noite UTC apareceria como o dia anterior no Brasil.
 *  - MOMENTO (`timestamptz`, ex.: created_at/updated_at) → Unix em segundos,
 *    com fração (milissegundos), como o GSS devolve.
 *
 * Entrada aceita Unix (número) e, por compatibilidade, o formato antigo
 * (`YYYY-MM-DD` para dia; ISO 8601 com fuso para momento). Unix recebido como
 * DIA vira o dia do calendário UTC daquele instante.
 *
 * Sem imports com alias: também é usado por lib/gss/outbound (roda no CLI).
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" → Unix (s) às 12:00 UTC. null/inválido → null. */
export function dayToUnix(day: string | null | undefined): number | null {
  if (!day) return null;
  const ms = Date.parse(`${day.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(ms) ? ms / 1000 : null;
}

/** Timestamp ISO do banco → Unix (s) com fração. null/inválido → null. */
export function timestampToUnix(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms / 1000 : null;
}

/** Unix (s) → "YYYY-MM-DD" do calendário UTC. */
function unixToDay(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/** Limites razoáveis: 1970 a 2200 (pega quem mandou milissegundos por engano). */
const MAX_UNIX = 7_258_118_400;

const unixSeconds = z
  .number()
  .finite()
  .min(0, "Unix timestamp must be in seconds (>= 0).")
  .max(MAX_UNIX, "Unix timestamp must be in SECONDS, not milliseconds.");

/**
 * DIA de entrada: Unix (s) ou "YYYY-MM-DD" → sempre "YYYY-MM-DD" (o que a
 * coluna `date` guarda).
 */
export const apiDay = z.union(
  [
    unixSeconds.transform(unixToDay),
    z.string().regex(DAY_RE, "Date must be a Unix timestamp (seconds) or YYYY-MM-DD."),
  ],
  { error: "Date must be a Unix timestamp in SECONDS (not milliseconds) or YYYY-MM-DD." }
);

/**
 * MOMENTO de entrada vindo da QUERY STRING (`updated_since`): Unix (s) ou ISO
 * 8601 com fuso → ISO (o que o PostgREST compara com timestamptz).
 */
export const apiInstantQuery = z
  .string()
  .trim()
  .min(1)
  .transform((raw, ctx) => {
    if (/^\d+(\.\d+)?$/.test(raw)) {
      const n = Number(raw);
      if (n > MAX_UNIX) {
        ctx.addIssue({ code: "custom", message: "Unix timestamp must be in SECONDS, not milliseconds." });
        return z.NEVER;
      }
      return new Date(n * 1000).toISOString();
    }
    const iso = z.iso.datetime({ offset: true }).safeParse(raw);
    if (!iso.success) {
      ctx.addIssue({
        code: "custom",
        message: "Must be a Unix timestamp (seconds) or ISO 8601 with offset.",
      });
      return z.NEVER;
    }
    return raw;
  });
