import { handleSyncGss } from "./handler";

/**
 * Sync GSS → SOTWISE completo: todas as bibliotecas em sequência, depois Orders
 * e Lotes (Run manual). O agendado roda um passo por cron em `[lib]/route.ts`
 * (§9.12). Lógica em `handler.ts`.
 */

// Sem passo são ~10 endpoints em sequência mais Orders/Lotes; o limite real de
// cada plano da Vercel se aplica por cima deste número.
export const maxDuration = 300;

export function GET(request: Request) {
  return handleSyncGss(request, null);
}
