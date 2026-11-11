import "server-only";

import { fetchAll } from "@/lib/fetch-all";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CompanyType } from "@/types/database";

/**
 * Chat de suporte do portal (05/11/2026): UMA thread por cliente, entre os
 * usuários do cliente e os REPRESENTANTES dele (usuários internos marcados no
 * cadastro do cliente). Todos os representantes recebem; qualquer um responde.
 *
 * Quem chama decide o escopo: no portal o `clientId` vem SEMPRE de
 * `requireClientScope()` (nunca de parâmetro do browser); no interno, de
 * `requireFeature("support")`. RLS é deny-all — este módulo não confere dono.
 */

export const SUPPORT_MAX_LENGTH = 2000;

export type SupportRepresentative = {
  id: string;
  name: string;
  company: CompanyType;
  email: string | null;
};

export type SupportMessage = {
  id: string;
  body: string;
  createdAt: string;
  authorId: string;
  authorName: string;
  /** Autor é do cliente (externo) — no portal é "você/sua equipe"; no interno, o cliente. */
  fromClient: boolean;
};

export type SupportConversation = {
  clientId: string;
  clientName: string;
  lastMessage: string | null;
  lastAt: string | null;
  lastFromClient: boolean;
  unread: number;
  representatives: string[];
  /** O usuário da sessão é representante deste cliente. */
  mine: boolean;
};

type Admin = ReturnType<typeof createAdminClient>;

/** Representantes do cliente, com e-mail (vem do Auth, não de `profiles`). */
export async function loadRepresentatives(clientId: string): Promise<SupportRepresentative[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("client_representatives")
    .select("user_id, profiles(full_name, company, status)")
    .eq("client_id", clientId)
    .returns<
      {
        user_id: string;
        profiles: { full_name: string; company: CompanyType; status: string } | null;
      }[]
    >();

  // Bloqueado sai da lista do cliente: não adianta oferecer quem não responde.
  const reps = (data ?? []).filter((r) => r.profiles && r.profiles.status !== "blocked");
  const emails = await Promise.all(
    reps.map((r) =>
      admin.auth.admin
        .getUserById(r.user_id)
        .then((res) => res.data.user?.email ?? null)
        .catch(() => null)
    )
  );
  return reps
    .map((r, i) => ({
      id: r.user_id,
      name: r.profiles!.full_name.trim(),
      company: r.profiles!.company,
      email: emails[i],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Thread inteira do cliente, da mais antiga para a mais nova. */
export async function loadSupportThread(clientId: string): Promise<SupportMessage[]> {
  const admin = createAdminClient();
  const rows = await fetchAll<{
    id: string;
    body: string;
    created_at: string;
    author_id: string;
    profiles: { full_name: string; client_id: string | null } | null;
  }>((from, to) =>
    admin
      .from("support_messages")
      .select("id, body, created_at, author_id, profiles(full_name, client_id)")
      .eq("client_id", clientId)
      .order("created_at")
      .range(from, to)
      .returns<
        {
          id: string;
          body: string;
          created_at: string;
          author_id: string;
          profiles: { full_name: string; client_id: string | null } | null;
        }[]
      >()
  );
  return rows.map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.created_at,
    authorId: m.author_id,
    authorName: m.profiles?.full_name.trim() || "—",
    fromClient: !!m.profiles?.client_id,
  }));
}

export async function sendSupportMessage(input: {
  clientId: string;
  authorId: string;
  body: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: "Empty message." };
  if (body.length > SUPPORT_MAX_LENGTH) {
    return { ok: false, error: `Message is longer than ${SUPPORT_MAX_LENGTH} characters.` };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("support_messages")
    .insert({ client_id: input.clientId, author_id: input.authorId, body });
  if (error) return { ok: false, error: error.message };
  // Quem escreve leu tudo até aqui.
  await markSupportRead(input.clientId, input.authorId, admin);
  return { ok: true };
}

export async function markSupportRead(
  clientId: string,
  userId: string,
  admin: Admin = createAdminClient()
): Promise<void> {
  await admin
    .from("support_reads")
    .upsert(
      { client_id: clientId, user_id: userId, last_read_at: new Date().toISOString() },
      { onConflict: "client_id,user_id" }
    );
}

/** Mensagens de OUTRAS pessoas que o usuário ainda não leu, na thread do cliente. */
export async function unreadInThread(clientId: string, userId: string): Promise<number> {
  const admin = createAdminClient();
  const { data: read } = await admin
    .from("support_reads")
    .select("last_read_at")
    .eq("client_id", clientId)
    .eq("user_id", userId)
    .maybeSingle();
  let q = admin
    .from("support_messages")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .neq("author_id", userId);
  if (read?.last_read_at) q = q.gt("created_at", read.last_read_at);
  const { count } = await q;
  return count ?? 0;
}

/**
 * Conversas para a tela interna: todo cliente que já tem mensagem, mais os
 * clientes que o usuário representa (mesmo sem mensagem — para ele saber que é
 * o contato). Mais recente primeiro; sem mensagem vai para o fim.
 */
export async function loadSupportConversations(userId: string): Promise<SupportConversation[]> {
  const admin = createAdminClient();
  const [messages, reps, reads] = await Promise.all([
    fetchAll<{
      client_id: string;
      body: string;
      created_at: string;
      author_id: string;
      profiles: { client_id: string | null } | null;
    }>((from, to) =>
      admin
        .from("support_messages")
        .select("client_id, body, created_at, author_id, profiles(client_id)")
        .order("created_at")
        .range(from, to)
        .returns<
          {
            client_id: string;
            body: string;
            created_at: string;
            author_id: string;
            profiles: { client_id: string | null } | null;
          }[]
        >()
    ),
    fetchAll<{ client_id: string; user_id: string; profiles: { full_name: string } | null }>(
      (from, to) =>
        admin
          .from("client_representatives")
          .select("client_id, user_id, profiles(full_name)")
          .range(from, to)
          .returns<
            { client_id: string; user_id: string; profiles: { full_name: string } | null }[]
          >()
    ),
    fetchAll<{ client_id: string; last_read_at: string }>((from, to) =>
      admin
        .from("support_reads")
        .select("client_id, last_read_at")
        .eq("user_id", userId)
        .range(from, to)
    ),
  ]);

  const lastRead = new Map(reads.map((r) => [r.client_id, r.last_read_at]));
  const repsByClient = new Map<string, { names: string[]; mine: boolean }>();
  for (const r of reps) {
    const e = repsByClient.get(r.client_id) ?? { names: [], mine: false };
    if (r.profiles?.full_name) e.names.push(r.profiles.full_name.trim());
    if (r.user_id === userId) e.mine = true;
    repsByClient.set(r.client_id, e);
  }

  const byClient = new Map<
    string,
    { last: (typeof messages)[number] | null; unread: number }
  >();
  for (const m of messages) {
    const e = byClient.get(m.client_id) ?? { last: null, unread: 0 };
    e.last = m; // ordem crescente: a última que passar é a mais nova
    const read = lastRead.get(m.client_id);
    if (m.author_id !== userId && (!read || m.created_at > read)) e.unread += 1;
    byClient.set(m.client_id, e);
  }

  const clientIds = [
    ...new Set([
      ...byClient.keys(),
      ...[...repsByClient].filter(([, v]) => v.mine).map(([id]) => id),
    ]),
  ];
  if (clientIds.length === 0) return [];

  const clients = await fetchAll<{ id: string; name: string }>((from, to) =>
    admin.from("clients").select("id, name").in("id", clientIds).range(from, to)
  );
  const clientName = new Map(clients.map((c) => [c.id, c.name]));

  return clientIds
    .map((id) => {
      const thread = byClient.get(id);
      const rep = repsByClient.get(id);
      return {
        clientId: id,
        clientName: clientName.get(id) ?? "—",
        lastMessage: thread?.last?.body ?? null,
        lastAt: thread?.last?.created_at ?? null,
        lastFromClient: !!thread?.last?.profiles?.client_id,
        unread: thread?.unread ?? 0,
        representatives: (rep?.names ?? []).sort((a, b) => a.localeCompare(b)),
        mine: rep?.mine ?? false,
      };
    })
    .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
}
