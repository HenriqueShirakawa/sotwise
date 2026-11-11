import "server-only";

import { cookies } from "next/headers";

import { OPERATION_TIME_ZONE, isValidTimeZone, todayIso } from "@/lib/format";

/**
 * Fuso de quem está usando, no servidor (11/11/2026, card da call de 10/11,
 * item 5). O navegador grava o próprio fuso no cookie `tz`
 * (components/time-zone-cookie); aqui ele é lido para o "hoje" das validações
 * e das datas automáticas (Completed on, ready date…) ser o dia de quem usa —
 * na China, o dia da China. Sem cookie ou fora de uma request (GSS pela API,
 * cron, script): São Paulo, como sempre foi.
 */
export const TIME_ZONE_COOKIE = "tz";

export async function userTimeZone(): Promise<string> {
  try {
    const tz = (await cookies()).get(TIME_ZONE_COOKIE)?.value;
    if (isValidTimeZone(tz)) return tz;
  } catch {
    // Fora de request (cron/script): sem cookies.
  }
  return OPERATION_TIME_ZONE;
}

/** "YYYY-MM-DD" de hoje no fuso de quem usa (ver `userTimeZone`). */
export async function userTodayIso(): Promise<string> {
  return todayIso(await userTimeZone());
}
