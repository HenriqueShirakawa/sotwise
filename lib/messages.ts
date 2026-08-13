import "server-only";

import { serverEnv } from "@/lib/env";
import { MESSAGES_EVENT, MESSAGES_TOPIC, type MessagePing } from "@/lib/messages-channel";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MessageEntity } from "@/types/database";

/**
 * Avisa os clientes conectados que existe mensagem nova. Vai pela API REST do
 * Realtime (não pelo WebSocket do supabase-js): numa função serverless não há
 * conexão para manter viva, e um POST resolve.
 *
 * Falha aqui NUNCA derruba o envio — a mensagem já está gravada, e o polling
 * pega o atraso. Por isso o erro é registrado e engolido.
 */
export async function broadcastMessagePing(ping: MessagePing): Promise<void> {
  try {
    const res = await fetch(`${serverEnv.supabaseUrl}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        apikey: serverEnv.supabaseServiceRoleKey,
        Authorization: `Bearer ${serverEnv.supabaseServiceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            topic: MESSAGES_TOPIC,
            event: MESSAGES_EVENT,
            payload: ping,
            private: true,
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error("[messages] broadcast falhou:", res.status, await res.text());
    }
  } catch (error) {
    console.error("[messages] broadcast falhou:", error);
  }
}

/** Uma mensagem já resolvida para exibição (autor e destinatários com nome). */
export type ThreadMessage = {
  id: string;
  body: string;
  created_at: string;
  author_id: string;
  author_name: string;
  /** Quem foi marcado no "Forward to", com a leitura de cada um. */
  recipients: { user_id: string; name: string; read_at: string | null }[];
  /** Rótulo do registro — só usado na caixa geral, onde a thread mistura registros. */
  context?: string;
};

/** Contador do balão: mensagens em que fui marcado e ainda não li. */
export async function countUnreadMessages(userId: string): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("message_recipients")
    .select("message_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  return count ?? 0;
}

/**
 * Rótulo do registro que ancora a thread — é o que o Bubble mostra travado no
 * topo do modal ("1392") e carimbado no corpo ("Client / Number Order").
 */
export async function loadEntityContext(
  entityType: MessageEntity,
  entityId: string
): Promise<{ number: string; client: string | null } | null> {
  const admin = createAdminClient();

  if (entityType === "order") {
    const { data } = await admin
      .from("orders")
      .select("po_number, client_id")
      .eq("id", entityId)
      .maybeSingle();
    if (!data) return null;
    return { number: data.po_number, client: await clientName(data.client_id) };
  }

  if (entityType === "pre_loading") {
    const { data } = await admin
      .from("pre_loadings")
      .select("pl_number")
      .eq("id", entityId)
      .maybeSingle();
    return data ? { number: data.pl_number, client: null } : null;
  }

  const { data } = await admin
    .from("shipments")
    .select("pre_loading_id")
    .eq("id", entityId)
    .maybeSingle();
  if (!data) return null;
  const { data: pl } = await admin
    .from("pre_loadings")
    .select("pl_number")
    .eq("id", data.pre_loading_id)
    .maybeSingle();
  return { number: pl?.pl_number ?? "—", client: null };
}

export type EntityRef = { type: MessageEntity; id: string };
export type EntityContext = { number: string; client: string | null; clientId: string | null };

/**
 * Contexto de VÁRIOS registros de uma vez — a caixa geral mistura pedidos, e
 * resolver um a um seria uma consulta por mensagem.
 */
export async function loadEntityContexts(
  refs: EntityRef[]
): Promise<Map<string, EntityContext>> {
  const admin = createAdminClient();
  const out = new Map<string, EntityContext>();
  const key = (r: EntityRef) => `${r.type}:${r.id}`;

  const ids = (type: MessageEntity) =>
    [...new Set(refs.filter((r) => r.type === type).map((r) => r.id))];

  const orderIds = ids("order");
  if (orderIds.length) {
    const { data } = await admin
      .from("orders")
      .select("id, po_number, client_id")
      .in("id", orderIds);
    const clientIds = [...new Set((data ?? []).map((o) => o.client_id).filter(Boolean))];
    const { data: clients } = clientIds.length
      ? await admin.from("clients").select("id, name").in("id", clientIds as string[])
      : { data: [] };
    const clientById = new Map((clients ?? []).map((c) => [c.id, c.name]));
    for (const o of data ?? []) {
      out.set(key({ type: "order", id: o.id }), {
        number: o.po_number,
        client: o.client_id ? clientById.get(o.client_id) ?? null : null,
        clientId: o.client_id,
      });
    }
  }

  const plIds = ids("pre_loading");
  const shipmentIds = ids("shipment");
  // Shipment é 1:1 com PL e exibe o número do PL — resolve os dois juntos.
  const shipmentToPl = new Map<string, string>();
  if (shipmentIds.length) {
    const { data } = await admin
      .from("shipments")
      .select("id, pre_loading_id")
      .in("id", shipmentIds);
    for (const s of data ?? []) shipmentToPl.set(s.id, s.pre_loading_id);
  }

  const allPlIds = [...new Set([...plIds, ...shipmentToPl.values()])];
  if (allPlIds.length) {
    const { data } = await admin
      .from("pre_loadings")
      .select("id, pl_number")
      .in("id", allPlIds);
    const plNumber = new Map((data ?? []).map((p) => [p.id, p.pl_number]));

    for (const id of plIds) {
      out.set(key({ type: "pre_loading", id }), {
        number: plNumber.get(id) ?? "—",
        client: null,
        clientId: null,
      });
    }
    for (const [shipmentId, plId] of shipmentToPl) {
      out.set(key({ type: "shipment", id: shipmentId }), {
        number: plNumber.get(plId) ?? "—",
        client: null,
        clientId: null,
      });
    }
  }

  return out;
}

async function clientName(clientId: string | null): Promise<string | null> {
  if (!clientId) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("clients")
    .select("name")
    .eq("id", clientId)
    .maybeSingle();
  return data?.name ?? null;
}

/** Nome de cada profile citado, numa consulta só. */
export async function loadProfileNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();

  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("id, full_name").in("id", unique);
  return new Map((data ?? []).map((p) => [p.id, p.full_name || "—"]));
}

/** Monta as mensagens com autor e destinatários resolvidos. */
export async function hydrateMessages(
  rows: { id: string; body: string; created_at: string; author_id: string }[]
): Promise<ThreadMessage[]> {
  if (!rows.length) return [];

  const admin = createAdminClient();
  const { data: recipientRows } = await admin
    .from("message_recipients")
    .select("message_id, user_id, read_at")
    .in(
      "message_id",
      rows.map((r) => r.id)
    );

  const names = await loadProfileNames([
    ...rows.map((r) => r.author_id),
    ...(recipientRows ?? []).map((r) => r.user_id),
  ]);

  const byMessage = new Map<string, ThreadMessage["recipients"]>();
  for (const r of recipientRows ?? []) {
    const list = byMessage.get(r.message_id) ?? [];
    list.push({ user_id: r.user_id, name: names.get(r.user_id) ?? "—", read_at: r.read_at });
    byMessage.set(r.message_id, list);
  }

  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    created_at: r.created_at,
    author_id: r.author_id,
    author_name: names.get(r.author_id) ?? "—",
    recipients: byMessage.get(r.id) ?? [],
  }));
}
