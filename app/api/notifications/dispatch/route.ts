import { createHash, timingSafeEqual } from "node:crypto";

import { dispatchClientNotifications } from "@/domain/client/notifications";

/**
 * Drenagem manual da outbox `client_notifications` (Fase 2.1).
 *
 * O caminho normal NÃO passa por aqui: `syncOrderStatus` agenda a drenagem com
 * `after()` a cada avanço de lote, então o e-mail sai sozinho. Este endpoint é
 * a rede de segurança para os casos em que aquele empurrão não acontece:
 *   - status alterado fora do app (SQL Editor, script);
 *   - envio que falhou e ficou na fila com `attempts < 3`;
 *   - conferência manual ("saiu alguma coisa?").
 *
 * Autorizado pelo mesmo segredo do cron, em tempo constante. Não está no
 * vercel.json de propósito — o disparo agendado foi descartado como mecanismo
 * (ver docs §8); se um dia voltar, é só apontar um cron para cá.
 */

export const maxDuration = 60;

function secretMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return Response.json({ error: "CRON_SECRET not configured." }, { status: 503 });
  }
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !secretMatches(token, expected)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const origin = new URL(request.url).origin;

  try {
    const result = await dispatchClientNotifications(origin);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[notifications/dispatch]", message);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
