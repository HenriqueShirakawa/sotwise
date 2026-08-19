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
/* Caixa geral (balão fora de um registro): abas Received / Sent               */
/* -------------------------------------------------------------------------- */

/** received = recebidas (fui destinatário) · sent = enviadas (eu sou o autor). */
export type BoxTab = "received" | "sent";

/** Dois grupos de número que o usuário reconhece: PO (order) e PL (pre_loading + shipment). */
export type RecordGroup = "po" | "pl";

/** order → "po"; pre_loading e shipment → "pl" (dividem o PL number). */
const groupOf = (type: MessageEntity): RecordGroup => (type === "order" ? "po" : "pl");

export type BoxFilters = {
  tab: BoxTab;
  /** "All Messages" / lidas / não lidas. */
  status: "all" | "read" | "unread";
  /** Received: filtra pelo remetente (autor). Sent: filtra pelo destinatário. */
  personId: string | null;
  /** Grupo do número: PO (order) ou PL (pre_loading + shipment). null = qualquer. */
  recordGroup: RecordGroup | null;
  /** Número do registro (PO ou PL); combina com recordGroup. */
  recordNumber: string | null;
  clientId: string | null;
  from: string | null;
  to: string | null;
};

export type BoxMessage = ThreadMessage & {
  entity: { type: MessageEntity; id: string };
  number: string;
  /** Nome(s) do(s) cliente(s) para exibição — PL/Shipment podem ter vários. */
  client: string | null;
  /** Ids dos clientes do registro — base do filtro por cliente. */
  clientIds: string[];
  /**
   * Estado de leitura sob a ótica da aba: em Received, se EU já li; em Sent, se
   * TODOS os destinatários já leram. É o que o filtro Read/Unread usa.
   */
  read: boolean;
};

/**
 * Received: a leitura é minha (message_recipients). Sent: eu sou o autor e não
 * tenho linha lá, então vale a leitura dos destinatários — só "lida" quando
 * todos leram (sem destinatário não há o que ler → lida).
 */
function isRead(
  tab: BoxTab,
  recipients: ThreadMessage["recipients"],
  mine: boolean | undefined
): boolean {
  if (tab === "received") return mine ?? true;
  if (recipients.length === 0) return true;
  return recipients.every((r) => Boolean(r.read_at));
}

export type BoxPayload = {
  messages: BoxMessage[];
  options: {
    people: Option[];
    /** Números que têm mensagem, por grupo (PO/PL), deduplicados e ordenados. */
    records: { group: RecordGroup; number: string }[];
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

  // Received: a base são as mensagens endereçadas a mim (message_recipients),
  // e guardo minha leitura de cada uma. Sent: as que eu escrevi (author_id).
  const readByMe = new Map<string, boolean>();
  if (filters.tab === "received") {
    const { data: mine } = await admin
      .from("message_recipients")
      .select("message_id, read_at")
      .eq("user_id", session.userId);
    for (const r of mine ?? []) readByMe.set(r.message_id, !!r.read_at);
  }

  const query = admin
    .from("messages")
    .select("id, body, created_at, author_id, entity_type, entity_id")
    .order("created_at", { ascending: false })
    .limit(MAX_BOX_MESSAGES);

  const { data: rows } =
    filters.tab === "received"
      ? readByMe.size
        ? await query.in("id", [...readByMe.keys()])
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
      client: ctx && ctx.clients.length ? ctx.clients.map((c) => c.name).join(", ") : null,
      clientIds: ctx?.clients.map((c) => c.id) ?? [],
      read: isRead(filters.tab, row.recipients, readByMe.get(r.id)),
    };
  });

  // Opções dos filtros saem do conjunto inteiro — não encolhem ao filtrar.
  const peopleSeen = new Map<string, string>();
  const recordsSeen = new Map<string, { group: RecordGroup; number: string }>();
  const clientsSeen = new Map<string, string>();
  for (const m of all) {
    // Received: a pessoa é o remetente (autor). Sent: são os destinatários.
    if (filters.tab === "received") peopleSeen.set(m.author_id, m.author_name);
    else for (const r of m.recipients) peopleSeen.set(r.user_id, r.name);
    // Dedup por grupo+número: PL e seu shipment de mesmo número viram uma opção só.
    const group = groupOf(m.entity.type);
    recordsSeen.set(`${group}|${m.number}`, { group, number: m.number });
    const ctx = contexts.get(`${m.entity.type}:${m.entity.id}`);
    for (const c of ctx?.clients ?? []) clientsSeen.set(c.id, c.name);
  }

  const messages = all.filter((m) => {
    if (filters.status === "read" && !m.read) return false;
    if (filters.status === "unread" && m.read) return false;
    if (filters.personId) {
      const match =
        filters.tab === "received"
          ? m.author_id === filters.personId
          : m.recipients.some((r) => r.user_id === filters.personId);
      if (!match) return false;
    }
    if (filters.recordGroup && groupOf(m.entity.type) !== filters.recordGroup) return false;
    if (filters.recordNumber && m.number !== filters.recordNumber) return false;
    if (filters.clientId && !m.clientIds.includes(filters.clientId)) return false;
    const day = m.created_at.slice(0, 10);
    if (filters.from && day < filters.from) return false;
    if (filters.to && day > filters.to) return false;
    return true;
  });

  return {
    messages,
    options: {
      people: [...peopleSeen].map(([id, name]) => ({ id, name })).sort(byName),
      records: [...recordsSeen.values()].sort((a, b) => numberDesc(a.number, b.number)),
      clients: [...clientsSeen].map(([id, name]) => ({ id, name })).sort(byName),
    },
    people: await loadPeople(session.userId),
    me,
    unread: await countUnreadMessages(session.userId),
  };
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/**
 * Descendente por número (texto): numéricos primeiro em ordem numérica —
 * "1000" antes de "999" —, não-numéricos por texto no fim.
 */
const numberDesc = (a: string, b: string): number => {
  const na = Number(a);
  const nb = Number(b);
  const aNum = a.trim() !== "" && Number.isFinite(na);
  const bNum = b.trim() !== "" && Number.isFinite(nb);
  if (aNum && bNum) return nb - na;
  if (aNum) return -1;
  if (bNum) return 1;
  return b.localeCompare(a);
};

/**
 * Números oferecidos no seletor de registro do compositor, POR TIPO. O usuário
 * escolhe antes se é Order / PL / Shipment e depois o número — assim "1000" não
 * fica ambíguo entre um PO e um PL. Order usa o PO number; Pre-loading e
 * Shipment usam o PL number (shipment não tem número próprio, é 1:1 com o PL).
 * A lista é completa e descendente (o seletor filtra por texto em cima):
 *  - o PostgREST capa em 1000 linhas por resposta, então paginamos por `id`;
 *  - o número é TEXTO, e ordenar texto joga os de 4 dígitos (1000+) pro meio
 *    ("999" > "1000"); a ordenação final é numérica, feita aqui.
 */
export async function loadRecordOptions(type: MessageEntity): Promise<Option[]> {
  await verifySession();
  const admin = createAdminClient();

  if (type === "order") {
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

  if (type === "pre_loading") {
    const rows = await fetchAll<{ id: string; pl_number: string }>((from, to) =>
      admin
        .from("pre_loadings")
        .select("id, pl_number")
        .is("deleted_at", null)
        .order("id", { ascending: true })
        .range(from, to)
    );
    return rows.map((p) => ({ id: p.id, name: p.pl_number })).sort(byOrderNumberDesc);
  }

  // shipment: o número exibido é o PL number do pre_loading vinculado.
  const ships = await fetchAll<{ id: string; pre_loading_id: string }>((from, to) =>
    admin
      .from("shipments")
      .select("id, pre_loading_id")
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(from, to)
  );
  const plIds = [...new Set(ships.map((s) => s.pre_loading_id).filter(Boolean))];
  const plNumber = new Map<string, string>();
  for (let i = 0; i < plIds.length; i += 500) {
    const { data } = await admin
      .from("pre_loadings")
      .select("id, pl_number")
      .in("id", plIds.slice(i, i + 500));
    for (const p of data ?? []) plNumber.set(p.id, p.pl_number);
  }
  return ships
    .map((s) => ({ id: s.id, name: plNumber.get(s.pre_loading_id) ?? "—" }))
    .sort(byOrderNumberDesc);
}

/** Descendente por número; PO numéricos primeiro, não-numéricos por texto. */
const byOrderNumberDesc = (a: Option, b: Option) => numberDesc(a.name, b.name);

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

  let recipients = [...new Set(parsed.data.recipient_ids)].filter(
    (id) => id !== session.userId
  );

  // Sem destinatário = notificação pra TODA a equipe do remetente: mesma company
  // (BR = AGK, China = ZK), usuários ativos e não ocultos, menos o próprio autor.
  if (recipients.length === 0 && session.profile.company) {
    const team = await fetchAll<{ id: string }>((from, to) =>
      admin
        .from("profiles")
        .select("id")
        .eq("company", session.profile.company)
        .eq("status", "active")
        .eq("hidden", false)
        .neq("id", session.userId)
        .range(from, to)
    );
    recipients = team.map((t) => t.id);
  }

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
