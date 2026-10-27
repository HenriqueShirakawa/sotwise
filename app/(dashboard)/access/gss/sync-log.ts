import "server-only";

import { ordersPullEnabled } from "@/lib/gss/sync-orders";
import type { createAdminClient } from "@/lib/supabase/admin";

import type { SyncRow, SyncTab } from "./sync-client";

export const SYNC_LOG_LIMIT = 300;

function hoursAgoIso(h: number): string {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

/**
 * O que o cron trouxe do GSS para Orders e Lotes (`gss_sync_log`, gravado por
 * lib/gss/sync-orders.ts). Mostrado nas abas Orders e Lotes do GSS parity
 * (pedido do usuário em 27/10/2026: junto do parity, não numa tela à parte).
 */
export async function loadSyncLog(
  admin: ReturnType<typeof createAdminClient>,
  { tab, onlyProblems, search }: { tab: SyncTab; onlyProblems: boolean; search: string }
) {
  const entity = tab === "batches" ? "batch" : "order";

  let query = admin
    .from("gss_sync_log")
    .select("id, created_at, action, gss_id, ref, order_id, changes, message, origin")
    .eq("entity", entity)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(SYNC_LOG_LIMIT);
  if (onlyProblems) query = query.in("action", ["warning", "error"]);
  if (search) {
    // vírgula e parênteses quebram o filtro `or` do PostgREST
    const term = search.replace(/[,()]/g, " ");
    query = /^\d+$/.test(term)
      ? query.or(`ref.ilike.%${term}%,gss_id.eq.${term}`)
      : query.ilike("ref", `%${term}%`);
  }
  const { data, error } = await query;

  const since = hoursAgoIso(24);
  const [{ count: changes24 }, { count: problems24 }, { data: state }] = await Promise.all([
    admin.from("gss_sync_log").select("id", { count: "exact", head: true }).eq("entity", entity).gte("created_at", since),
    admin
      .from("gss_sync_log")
      .select("id", { count: "exact", head: true })
      .eq("entity", entity)
      .gte("created_at", since)
      .in("action", ["warning", "error"]),
    admin
      .from("gss_sync_state")
      .select("last_run_at, last_status, last_error")
      .eq("resource", tab)
      .maybeSingle(),
  ]);

  const rows: SyncRow[] = (data ?? []).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    action: r.action,
    gssId: r.gss_id,
    ref: r.ref,
    orderId: r.order_id,
    changes: r.changes ?? [],
    message: r.message,
    origin: r.origin,
  }));

  return {
    tab,
    rows,
    limit: SYNC_LOG_LIMIT,
    changes24: changes24 ?? 0,
    problems24: problems24 ?? 0,
    lastRun: state?.last_run_at
      ? { at: state.last_run_at, ok: state.last_status !== "error", error: state.last_error }
      : null,
    locked: !ordersPullEnabled(),
    filters: { onlyProblems, search },
    loadError: error
      ? `Não deu para ler o log (${error.message}). A tabela vem da migration 20261027120000_gss_sync_log.sql — aplique no Supabase.`
      : null,
  };
}
