"use server";

import { markSupportRead, sendSupportMessage } from "@/domain/support/chat";
import { requireClientScope } from "@/lib/dal";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Envio do lado do cliente. O `clientId` sai da sessão (`requireClientScope`),
 * nunca do browser — é a única fronteira entre um cliente e a thread de outro.
 */
export async function sendPortalSupportMessage(body: string): Promise<Result> {
  const { session, clientId } = await requireClientScope();
  return sendSupportMessage({ clientId, authorId: session.userId, body });
}

export async function markPortalSupportRead(): Promise<void> {
  const { session, clientId } = await requireClientScope();
  await markSupportRead(clientId, session.userId);
}
