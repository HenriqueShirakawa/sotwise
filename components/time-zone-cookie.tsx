"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { browserTimeZone } from "@/lib/format";

/**
 * Grava o fuso do computador no cookie `tz` (11/11/2026, card da call de 10/11,
 * item 5) — o servidor usa para o "hoje" de quem usa (lib/user-time-zone).
 * Só reescreve quando muda (1ª visita, viagem, troca de fuso do sistema); na
 * 1ª vez atualiza a tela para o servidor já renderizar com o fuso certo.
 */
export function TimeZoneCookie() {
  const router = useRouter();
  useEffect(() => {
    const tz = browserTimeZone();
    if (!tz) return;
    const current = document.cookie
      .split("; ")
      .find((c) => c.startsWith("tz="))
      ?.slice(3);
    if (current && decodeURIComponent(current) === tz) return;
    document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [router]);
  return null;
}
