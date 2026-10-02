import "server-only";

import { after } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

import { dispatchGssOutbound, gssOutboundEnabled } from "./dispatch";

/**
 * Agenda a drenagem da fila do GSS para DEPOIS da resposta (`after` do Next 16)
 * — o save do usuário nunca espera o GSS nem falha por causa dele. Mesmo molde
 * de `scheduleClientNotificationDispatch` (domain/client/notifications.ts).
 *
 * Chamado pelas actions que mexem no PL (Create PL, etapas do checklist,
 * Confirm Shipping). Quem ENFILEIRA é o trigger; isto só apressa o envio. Se não
 * rodar (fora de request, chave desligada, erro), o evento fica na fila e sai no
 * próximo disparo — outra action, o cron diário ou o CLI.
 */
export async function scheduleGssOutboundDispatch(): Promise<void> {
  if (!gssOutboundEnabled()) return;
  try {
    after(async () => {
      try {
        const result = await dispatchGssOutbound(createAdminClient());
        if (result.errors.length) console.error("[gss-outbound]", result.errors.join(" | "));
      } catch (err) {
        console.error("[gss-outbound] disparo falhou:", err);
      }
    });
  } catch {
    // `after` fora do escopo suportado — a fila segura o evento.
  }
}
