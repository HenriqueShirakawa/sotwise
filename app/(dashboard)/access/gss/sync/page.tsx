import { requireOwner } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";

import { SyncClient, type SyncRow, type SyncTab } from "./sync-client";

const LIMIT = 300;

function hoursAgoIso(h: number): string {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

/**
 * O que o cron trouxe do GSS para Orders e Lotes (`gss_sync_log`, gravado por
 * lib/gss/sync-orders.ts) — owner-only, mesma porta do /access/gss. Uma aba
 * para Orders e outra para Lotes (pedido do usuário em 27/10/2026).
 */
export default async function GssSyncPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; f?: string; q?: string }>;
}) {
  await requireOwner();
  const { t, f, q } = await searchParams;
  const tab: SyncTab = t === "batches" ? "batches" : "orders";
  const entity = tab === "batches" ? "batch" : "order";
  const onlyProblems = f === "problemas";
  const search = (q ?? "").trim();

  const admin = createAdminClient();

  let query = admin
    .from("gss_sync_log")
    .select("id, created_at, action, gss_id, ref, order_id, changes, message, origin")
    .eq("entity", entity)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(LIMIT);
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

  return (
    <div>
      <PageHeader
        title="GSS sync"
        description="O que o cron diário trouxe do GSS para Orders e Lotes: o que foi criado, atualizado ou não pôde ser gravado."
      />

      <SyncClient
        tab={tab}
        rows={rows}
        limit={LIMIT}
        changes24={changes24 ?? 0}
        problems24={problems24 ?? 0}
        lastRun={
          state?.last_run_at
            ? { at: state.last_run_at, ok: state.last_status !== "error", error: state.last_error }
            : null
        }
        filters={{ onlyProblems, search }}
        loadError={
          error
            ? `Não deu para ler o log (${error.message}). A tabela vem da migration 20261027120000_gss_sync_log.sql — aplique no Supabase.`
            : null
        }
      />
    </div>
  );
}
