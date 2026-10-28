import { handleSyncGss } from "../handler";

/**
 * Um cron por biblioteca (docs/INTEGRACAO_GSS.md §9.12): `/api/cron/sync-gss/
 * <passo>` roda só aquele passo de `SYNC_STEPS`; `orders` roda Orders + Lotes.
 * Lógica em `../handler.ts`.
 */

export const maxDuration = 300;

export async function GET(request: Request, { params }: { params: Promise<{ lib: string }> }) {
  const { lib } = await params;
  return handleSyncGss(request, lib);
}
