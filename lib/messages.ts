import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { MessageEntity } from "@/types/database";

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
