import "server-only";

import { headers } from "next/headers";
import { after } from "next/server";

import {
  batchAdvanceEmailHtml,
  batchAdvanceSubject,
  type BatchAdvanceEmail,
} from "@/lib/email/batch-advance";
import { sendEmail } from "@/lib/email/resend";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BatchStatus } from "@/types/database";

/**
 * Despachante da outbox `client_notifications` (Fase 2.1).
 *
 * A CAPTURA é do trigger SQL (migration 20260819140000) — completa por
 * construção. Aqui é só a ENTREGA, e ela é deliberadamente burra e repetível:
 * lê pendentes, manda, carimba. Rodar duas vezes em paralelo pode, no pior
 * caso, mandar o mesmo aviso duas vezes; não rodar nunca não perde evento
 * nenhum, porque a linha continua lá esperando. Entre os dois riscos, esse é o
 * certo a escolher.
 *
 * `MAX_ATTEMPTS` existe para um endereço morto não prender a fila para sempre:
 * depois de 3 tentativas a linha sai da fila com o erro registrado, e o admin
 * vê o que aconteceu em vez de um retry infinito e silencioso.
 */

const BATCH_LIMIT = 50;
const MAX_ATTEMPTS = 3;

type PendingRow = {
  id: string;
  batch_id: string;
  order_id: string;
  client_id: string;
  to_status: BatchStatus;
  attempts: number;
};

export type DispatchResult = { sent: number; failed: number; skipped: number };

/**
 * Endereços de quem acompanha o cliente. O e-mail vive em `auth.users`, não no
 * profile — daí o `getUserById` por destinatário (são poucos por cliente).
 *
 * Bloqueado NÃO recebe: sem acesso ao portal, o link do e-mail só levaria a uma
 * porta fechada. `hidden` recebe normalmente — aquilo esconde de listagem
 * interna, não tira o acesso.
 */
async function recipientsForClient(
  admin: ReturnType<typeof createAdminClient>,
  clientId: string
): Promise<string[]> {
  const { data: profiles } = await admin
    .from("profiles")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "active");

  const emails: string[] = [];
  for (const profile of profiles ?? []) {
    const { data } = await admin.auth.admin.getUserById(profile.id);
    const email = data.user?.email;
    if (email) emails.push(email);
  }
  return emails;
}

/** Produtos (categorias) do lote — o que o cliente reconhece, em vez do lote. */
async function productsForBatch(
  admin: ReturnType<typeof createAdminClient>,
  batchId: string
): Promise<string[]> {
  const { data } = await admin
    .from("order_factory_category")
    .select("categories(name)")
    .eq("batch_id", batchId)
    .returns<{ categories: { name: string } | null }[]>();

  const names = (data ?? [])
    .map((row) => row.categories?.name?.trim())
    .filter((name): name is string => Boolean(name));

  return [...new Set(names)].sort();
}

/**
 * Agenda a drenagem para DEPOIS da resposta (`after` do Next 16).
 *
 * Chamado de `syncOrderStatus`, que é o único ponto por onde os nove caminhos
 * de escrita de status já passam — mesma lógica do trigger: em vez de confiar
 * que cada tela nova lembre de notificar, pendura no lugar que ninguém tem como
 * esquecer.
 *
 * Se não houver ciclo de request (script de CLI, por exemplo), não faz nada — e
 * isso não perde evento: ele continua na outbox, e sai no próximo disparo, seja
 * pela próxima ação no app ou pelo endpoint de drenagem.
 */
export async function scheduleClientNotificationDispatch(): Promise<void> {
  let origin: string | undefined;
  try {
    origin = (await headers()).get("origin") ?? undefined;
  } catch {
    return; // fora de request: nada a agendar
  }

  try {
    after(async () => {
      await dispatchClientNotifications(origin);
    });
  } catch {
    // `after` fora do escopo suportado — a outbox segura o evento.
  }
}

export async function dispatchClientNotifications(
  origin?: string
): Promise<DispatchResult> {
  const admin = createAdminClient();
  const result: DispatchResult = { sent: 0, failed: 0, skipped: 0 };

  const { data: pending } = await admin
    .from("client_notifications")
    .select("id, batch_id, order_id, client_id, to_status, attempts")
    .is("sent_at", null)
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at")
    .limit(BATCH_LIMIT)
    .returns<PendingRow[]>();

  if (!pending?.length) return result;

  // Cache por cliente: um avanço costuma vir em lote (confirmação de embarque
  // mexe em vários), e sem isto seria uma consulta de destinatários por linha.
  const recipientCache = new Map<string, string[]>();
  const clientNameCache = new Map<string, string>();

  for (const row of pending) {
    let recipients = recipientCache.get(row.client_id);
    if (!recipients) {
      recipients = await recipientsForClient(admin, row.client_id);
      recipientCache.set(row.client_id, recipients);
    }

    // Cliente sem usuário no portal: nada a enviar, e a linha sai da fila.
    // Marcar como enviada com `recipients` vazio é honesto — o evento foi
    // processado, não houve para quem mandar — e evita reprocessar para sempre.
    if (recipients.length === 0) {
      await admin
        .from("client_notifications")
        .update({ sent_at: new Date().toISOString(), last_error: "no portal users" })
        .eq("id", row.id);
      result.skipped += 1;
      continue;
    }

    let clientName = clientNameCache.get(row.client_id);
    if (!clientName) {
      const { data: client } = await admin
        .from("clients")
        .select("name")
        .eq("id", row.client_id)
        .single();
      clientName = client?.name ?? "";
      clientNameCache.set(row.client_id, clientName);
    }

    const { data: order } = await admin
      .from("orders")
      .select("po_number")
      .eq("id", row.order_id)
      .single();

    const payload: BatchAdvanceEmail = {
      clientName,
      poNumber: order?.po_number ?? "—",
      products: await productsForBatch(admin, row.batch_id),
      status: row.to_status,
      portalUrl: origin ? `${origin}/portal` : undefined,
    };

    const html = batchAdvanceEmailHtml(payload);
    const subject = batchAdvanceSubject(payload);

    // Um envio por destinatário, não um `to` coletivo: cliente não precisa ver
    // o endereço dos colegas, e uma falha individual não derruba o resto.
    const failures: string[] = [];
    const delivered: string[] = [];
    for (const to of recipients) {
      const sent = await sendEmail({ to, subject, html });
      if (sent.ok) delivered.push(to);
      else failures.push(`${to}: ${sent.error}`);
    }

    if (delivered.length > 0 && failures.length === 0) {
      await admin
        .from("client_notifications")
        .update({
          sent_at: new Date().toISOString(),
          recipients: delivered,
          attempts: row.attempts + 1,
        })
        .eq("id", row.id);
      result.sent += 1;
    } else {
      // Entrega parcial conta como falha para NÃO carimbar como resolvida uma
      // linha que deixou alguém de fora. O retry reenvia para todos — duplicar
      // um aviso é menos grave que um cliente nunca receber.
      await admin
        .from("client_notifications")
        .update({
          attempts: row.attempts + 1,
          last_error: failures.join(" | ").slice(0, 1000),
          recipients: delivered,
        })
        .eq("id", row.id);
      result.failed += 1;
    }
  }

  return result;
}
