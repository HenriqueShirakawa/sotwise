"use server";

import { z } from "zod";

import { verifySession } from "@/lib/dal";
import { fetchAll } from "@/lib/fetch-all";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  broadcastMessagePing,
  countUnreadMessages,
  hydrateMessages,
  loadEntityContext,
  loadEntityContexts,
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
export type Option = { id: string; name: string };

export type ThreadPayload = {
  messages: ThreadMessage[];
  /** Rótulo travado no topo do modal quando se está dentro de um registro. */
  context: { number: string; client: string | null } | null;
  people: Option[];
  /** Usuário logado — é ele que aparece no 2º campo travado do modal. */
  me: Option;
  unread: number;
};

/** Usuários selecionáveis no "Forward to" — ativos, não ocultos, menos eu. */
async function loadPeople(currentUserId: string): Promise<Option[]> {
  const admin = createAdminClient();
  const data = await fetchAll<{ id: string; full_name: string }>((from, to) =>
    admin
      .from("profiles")
      .select("id, full_name")
      .eq("status", "active")
      .eq("hidden", false)
      .order("full_name")
      .range(from, to)
  );

  return data
    .filter((p) => p.id !== currentUserId && p.full_name.trim())
    .map((p) => ({ id: p.id, name: p.full_name }));
}

/**
 * Thread de UM registro (a view de dentro do checklist). Todo mundo que abre o
 * registro vê o histórico completo, tenha sido marcado ou não.
 */
export async function loadThread(
  entityType: MessageEntity,
  entityId: string
): Promise<ThreadPayload> {
  const session = await verifySession();
  const me: Option = { id: session.userId, name: session.profile.full_name || "—" };

  const parsedType = entitySchema.safeParse(entityType);
  const parsedId = z.uuid().safeParse(entityId);
  if (!parsedType.success || !parsedId.success) {
    return { messages: [], context: null, people: [], me, unread: 0 };
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

  return { messages: await hydrateMessages(rows ?? []), context, people, me, unread };
}

/* -------------------------------------------------------------------------- */
/* Caixa geral (balão fora de um registro): abas Inbox / My messages           */
/* -------------------------------------------------------------------------- */

export type BoxTab = "inbox" | "mine";

export type BoxFilters = {
  tab: BoxTab;
  /** "All Messages" / lidas / não lidas. */
  status: "all" | "read" | "unread";
  /** Remetente (Inbox) ou destinatário (My messages). */
  personId: string | null;
  /** Registro no formato "order:<uuid>". */
  recordKey: string | null;
  clientId: string | null;
  from: string | null;
  to: string | null;
};

export type BoxMessage = ThreadMessage & {
  entity: { type: MessageEntity; id: string };
  number: string;
  client: string | null;
  /**
   * Estado de leitura sob a ótica da aba: no Inbox, se EU já li; em My messages,
   * se TODOS os destinatários já leram. É o que o filtro Read/Unread usa.
   */
  read: boolean;
};

/**
 * No Inbox a leitura é minha (vem de message_recipients). Em My messages eu sou
 * o autor e não tenho linha lá, então a leitura é a dos destinatários: só conta
 * como lida quando todos leram. Sem destinatário não há o que ler → lida.
 */
function isRead(
  tab: BoxTab,
  recipients: ThreadMessage["recipients"],
  mine: boolean | undefined
): boolean {
  if (tab === "inbox") return mine ?? true;
  if (recipients.length === 0) return true;
  return recipients.every((r) => Boolean(r.read_at));
}

export type BoxPayload = {
  messages: BoxMessage[];
  options: {
    people: Option[];
    records: { key: string; label: string }[];
    clients: Option[];
  };
  people: Option[];
  me: Option;
  unread: number;
};

const MAX_BOX_MESSAGES = 200;

export async function loadMessagesBox(filters: BoxFilters): Promise<BoxPayload> {
  const session = await verifySession();
  const admin = createAdminClient();
  const me: Option = { id: session.userId, name: session.profile.full_name || "—" };

  // Base: no Inbox, o que foi endereçado a mim; em My messages, o que eu enviei.
  const readByMe = new Map<string, boolean>();
  let baseIds: string[] | null = null;

  if (filters.tab === "inbox") {
    const { data: mine } = await admin
      .from("message_recipients")
      .select("message_id, read_at")
      .eq("user_id", session.userId);
    for (const r of mine ?? []) readByMe.set(r.message_id, !!r.read_at);
    baseIds = [...readByMe.keys()];
  }

  const query = admin
    .from("messages")
    .select("id, body, created_at, author_id, entity_type, entity_id")
    .order("created_at", { ascending: false })
    .limit(MAX_BOX_MESSAGES);

  const { data: rows } = baseIds
    ? baseIds.length
      ? await query.in("id", baseIds)
      : { data: [] }
    : await query.eq("author_id", session.userId);

  const base = rows ?? [];
  const contexts = await loadEntityContexts(
    base.map((r) => ({ type: r.entity_type, id: r.entity_id }))
  );
  const hydrated = await hydrateMessages(base);
  const byId = new Map(hydrated.map((m) => [m.id, m]));

  const all: BoxMessage[] = base.map((r) => {
    const ctx = contexts.get(`${r.entity_type}:${r.entity_id}`);
    const hydratedRow = byId.get(r.id);
    const row = hydratedRow ?? {
      id: r.id,
      body: r.body,
      created_at: r.created_at,
      author_id: r.author_id,
      author_name: "—",
      recipients: [],
    };
    return {
      ...row,
      entity: { type: r.entity_type, id: r.entity_id },
      number: ctx?.number ?? "—",
      client: ctx?.client ?? null,
      // No Inbox "lida" = eu li. Em My messages eu sou o AUTOR e nunca tenho
      // registro em message_recipients, então o mapa vem vazio — o `?? true`
      // marcava TODA mensagem enviada como lida e invertia o filtro (Unread não
      // trazia nada, Read trazia tudo). Aqui "lida" = todos os destinatários
      // leram, que é o que o contador "Messages read 0/1" do card já mostra.
      read: isRead(filters.tab, row.recipients, readByMe.get(r.id)),
    };
  });

  // Opções dos filtros saem do conjunto inteiro — não encolhem ao filtrar.
  const peopleSeen = new Map<string, string>();
  const recordsSeen = new Map<string, string>();
  const clientsSeen = new Map<string, string>();
  for (const m of all) {
    if (filters.tab === "inbox") peopleSeen.set(m.author_id, m.author_name);
    else for (const r of m.recipients) peopleSeen.set(r.user_id, r.name);
    recordsSeen.set(`${m.entity.type}:${m.entity.id}`, m.number);
    const ctx = contexts.get(`${m.entity.type}:${m.entity.id}`);
    if (ctx?.clientId && ctx.client) clientsSeen.set(ctx.clientId, ctx.client);
  }

  const messages = all.filter((m) => {
    if (filters.status === "read" && !m.read) return false;
    if (filters.status === "unread" && m.read) return false;
    if (filters.personId) {
      const match =
        filters.tab === "inbox"
          ? m.author_id === filters.personId
          : m.recipients.some((r) => r.user_id === filters.personId);
      if (!match) return false;
    }
    if (filters.recordKey && `${m.entity.type}:${m.entity.id}` !== filters.recordKey) {
      return false;
    }
    if (filters.clientId) {
      const ctx = contexts.get(`${m.entity.type}:${m.entity.id}`);
      if (ctx?.clientId !== filters.clientId) return false;
    }
    const day = m.created_at.slice(0, 10);
    if (filters.from && day < filters.from) return false;
    if (filters.to && day > filters.to) return false;
    return true;
  });

  return {
    messages,
    options: {
      people: [...peopleSeen].map(([id, name]) => ({ id, name })).sort(byName),
      records: [...recordsSeen].map(([key, label]) => ({ key, label })),
      clients: [...clientsSeen].map(([id, name]) => ({ id, name })).sort(byName),
    },
    people: await loadPeople(session.userId),
    me,
    unread: await countUnreadMessages(session.userId),
  };
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/**
 * TODOS os pedidos oferecidos no "Choose an Order" quando se escreve fora de um
 * registro — a lista precisa ser completa e descendente (o seletor filtra por
 * texto em cima dela). Duas coisas a resolver:
 *  - o PostgREST capa em 1000 linhas por resposta, então paginamos por `id`;
 *  - `po_number` é TEXTO, e ordenar texto joga os PO de 4 dígitos (1000+) pro
 *    meio ("999" > "1000"); a ordenação final é numérica, feita aqui.
 */
export async function loadOrderOptions(): Promise<Option[]> {
  await verifySession();
  const admin = createAdminClient();

  const rows = await fetchAll<{ id: string; po_number: string }>((from, to) =>
    admin
      .from("orders")
      .select("id, po_number")
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(from, to)
  );

  return rows.map((o) => ({ id: o.id, name: o.po_number })).sort(byOrderNumberDesc);
}

/** Descendente por número; PO numéricos primeiro, não-numéricos por texto. */
const byOrderNumberDesc = (a: Option, b: Option) => {
  const na = Number(a.name);
  const nb = Number(b.name);
  const aNum = a.name.trim() !== "" && Number.isFinite(na);
  const bNum = b.name.trim() !== "" && Number.isFinite(nb);
  if (aNum && bNum) return nb - na;
  if (aNum) return -1;
  if (bNum) return 1;
  return b.name.localeCompare(a.name);
};

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

  // Só depois dos destinatários gravados: quem receber o aviso vai recarregar
  // na hora, e precisa achar o contador de não lidas já correto.
  await broadcastMessagePing({
    message_id: data.id,
    entity_type: parsed.data.entity_type,
    entity_id: parsed.data.entity_id,
    author_id: session.userId,
    recipient_ids: recipients,
  });

  return { ok: true };
}

/** Só o contador do balão — é o que o polling do FAB pede de tempos em tempos. */
export async function loadUnreadCount(): Promise<number> {
  const session = await verifySession();
  return countUnreadMessages(session.userId);
}

/** "Mark as Read" / "Mark as Unread" de UMA mensagem da minha caixa. */
export async function setMessageRead(
  messageId: string,
  read: boolean
): Promise<{ ok: true; unread: number } | { ok: false; error: string }> {
  const session = await verifySession();

  const admin = createAdminClient();
  const { error } = await admin
    .from("message_recipients")
    .update({ read_at: read ? new Date().toISOString() : null })
    .eq("message_id", messageId)
    .eq("user_id", session.userId);
  if (error) return { ok: false, error: error.message };

  return { ok: true, unread: await countUnreadMessages(session.userId) };
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
