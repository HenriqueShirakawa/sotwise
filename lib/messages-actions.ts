"use server";

import { z } from "zod";

import { verifySession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  countUnreadMessages,
  hydrateMessages,
  loadEntityContext,
  type ThreadMessage,
} from "@/lib/messages";
import type { MessageEntity } from "@/types/database";

const entitySchema = z.enum(["order", "pre_loading", "shipment"]);

const sendSchema = z.object({
  entity_type: entitySchema,
  entity_id: z.uuid(),
  /** Limite do compositor no Bubble: 0/500. */
  body: z.string().trim().min(1, "Write a message.").max(500, "Message is too long."),
  recipient_ids: z.array(z.uuid()),
});

export type SendMessageInput = z.infer<typeof sendSchema>;

export type ThreadPayload = {
  messages: ThreadMessage[];
  /** Rótulo travado no topo do modal quando se está dentro de um registro. */
  context: { number: string; client: string | null } | null;
  people: { id: string; name: string }[];
  unread: number;
};

/** Usuários selecionáveis no "Forward to" — ativos, não ocultos, menos eu. */
async function loadPeople(currentUserId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("status", "active")
    .eq("hidden", false)
    .order("full_name");

  return (data ?? [])
    .filter((p) => p.id !== currentUserId && p.full_name.trim())
    .map((p) => ({ id: p.id, name: p.full_name }));
}

/**
 * Thread de UM registro. Dentro da tela do registro todo mundo vê o histórico
 * completo, tenha sido marcado ou não (regra confirmada com o cliente).
 */
export async function loadThread(
  entityType: MessageEntity,
  entityId: string
): Promise<ThreadPayload> {
  const session = await verifySession();

  const parsedType = entitySchema.safeParse(entityType);
  const parsedId = z.uuid().safeParse(entityId);
  if (!parsedType.success || !parsedId.success) {
    return { messages: [], context: null, people: [], unread: 0 };
  }

  const admin = createAdminClient();
  const [{ data: rows }, context, people, unread] = await Promise.all([
    admin
      .from("messages")
      .select("id, body, created_at, author_id")
      .eq("entity_type", parsedType.data)
      .eq("entity_id", parsedId.data)
      .order("created_at"),
    loadEntityContext(parsedType.data, parsedId.data),
    loadPeople(session.userId),
    countUnreadMessages(session.userId),
  ]);

  return { messages: await hydrateMessages(rows ?? []), context, people, unread };
}

/**
 * Caixa geral (balão fora de um registro): só as mensagens em que EU fui
 * marcado, de qualquer registro, com o rótulo do registro em cada uma.
 */
export async function loadInbox(): Promise<ThreadPayload> {
  const session = await verifySession();
  const admin = createAdminClient();

  const { data: mine } = await admin
    .from("message_recipients")
    .select("message_id")
    .eq("user_id", session.userId);

  const ids = (mine ?? []).map((m) => m.message_id);
  if (!ids.length) {
    return { messages: [], context: null, people: await loadPeople(session.userId), unread: 0 };
  }

  const { data: rows } = await admin
    .from("messages")
    .select("id, body, created_at, author_id, entity_type, entity_id")
    .in("id", ids)
    .order("created_at", { ascending: false })
    .limit(50);

  const messages = await hydrateMessages(rows ?? []);

  // Rótulo do registro de cada mensagem (a caixa geral mistura pedidos).
  const contexts = new Map<string, string>();
  for (const row of rows ?? []) {
    const key = `${row.entity_type}:${row.entity_id}`;
    if (contexts.has(key)) continue;
    const ctx = await loadEntityContext(row.entity_type, row.entity_id);
    contexts.set(key, ctx?.number ?? "—");
  }
  const withContext = messages.map((m) => {
    const row = (rows ?? []).find((r) => r.id === m.id);
    return row
      ? { ...m, context: contexts.get(`${row.entity_type}:${row.entity_id}`) }
      : m;
  });

  return {
    messages: withContext,
    context: null,
    people: await loadPeople(session.userId),
    unread: await countUnreadMessages(session.userId),
  };
}

export async function sendMessage(
  input: SendMessageInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await verifySession();

  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("messages")
    .insert({
      entity_type: parsed.data.entity_type,
      entity_id: parsed.data.entity_id,
      author_id: session.userId,
      body: parsed.data.body,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not send." };

  const recipients = [...new Set(parsed.data.recipient_ids)].filter(
    (id) => id !== session.userId
  );
  if (recipients.length) {
    const { error: linkError } = await admin
      .from("message_recipients")
      .insert(recipients.map((user_id) => ({ message_id: data.id, user_id })));
    if (linkError) return { ok: false, error: linkError.message };
  }

  return { ok: true };
}

/** Marca como lidas as minhas mensagens da thread aberta. */
export async function markThreadRead(
  entityType: MessageEntity,
  entityId: string
): Promise<{ ok: true; unread: number } | { ok: false; error: string }> {
  const session = await verifySession();

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("messages")
    .select("id")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId);

  const ids = (rows ?? []).map((r) => r.id);
  if (ids.length) {
    const { error } = await admin
      .from("message_recipients")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", session.userId)
      .is("read_at", null)
      .in("message_id", ids);
    if (error) return { ok: false, error: error.message };
  }

  return { ok: true, unread: await countUnreadMessages(session.userId) };
}

/** Marca tudo como lido a partir da caixa geral. */
export async function markAllRead(): Promise<
  { ok: true; unread: number } | { ok: false; error: string }
> {
  const session = await verifySession();

  const admin = createAdminClient();
  const { error } = await admin
    .from("message_recipients")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", session.userId)
    .is("read_at", null);
  if (error) return { ok: false, error: error.message };

  return { ok: true, unread: 0 };
}
