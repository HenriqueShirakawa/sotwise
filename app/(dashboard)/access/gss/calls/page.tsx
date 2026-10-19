import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireOwner } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";

import { CallsClient, type CallRow } from "./calls-client";

const LIMIT = 300;

function hoursAgoIso(h: number): string {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

/**
 * Chamadas do SOTWISE à API do GSS (`gss_call_log`) — owner-only, mesma porta
 * do /access/gss. Os envios ao GSS rodam depois da resposta da tela (`after()`),
 * então um erro não aparece para quem salvou: esta lista é onde ele aparece
 * (pedido do usuário em 19/10/2026, depois do PL 1470 recusado em silêncio).
 */
export default async function GssCallsPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; q?: string; s?: string }>;
}) {
  await requireOwner();
  const { f, q, s } = await searchParams;
  const onlyErrors = f === "erros";
  const search = (q ?? "").trim();
  const source = (s ?? "").trim();

  const admin = createAdminClient();

  let query = admin
    .from("gss_call_log")
    .select("id, created_at, method, path, status, kind, duration_ms, request_body, response_body, error, source, ref, origin")
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (onlyErrors) query = query.neq("kind", "ok");
  if (source) query = query.eq("source", source);
  if (search) {
    // vírgula e parênteses quebram o filtro `or` do PostgREST
    const term = search.replace(/[,()]/g, " ");
    query = query.or(`path.ilike.%${term}%,ref.ilike.%${term}%`);
  }
  const { data, error } = await query;

  const since = hoursAgoIso(24);
  const [{ count: total24 }, { count: errors24 }] = await Promise.all([
    admin.from("gss_call_log").select("id", { count: "exact", head: true }).gte("created_at", since),
    admin.from("gss_call_log").select("id", { count: "exact", head: true }).gte("created_at", since).neq("kind", "ok"),
  ]);

  const rows: CallRow[] = (data ?? []).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    method: r.method,
    path: r.path,
    status: r.status,
    kind: r.kind,
    durationMs: r.duration_ms,
    requestBody: r.request_body ?? null,
    responseBody: r.response_body,
    error: r.error,
    source: r.source,
    ref: r.ref,
    origin: r.origin,
  }));

  return (
    <div>
      <PageHeader
        title="GSS — chamadas"
        description="Toda chamada que o SOTWISE faz à API do GSS: o que foi enviado e o que o GSS respondeu."
      >
        <Link
          href="/access/gss"
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
        >
          <ArrowLeft className="size-4" />
          Dados do GSS
        </Link>
      </PageHeader>

      <CallsClient
        rows={rows}
        limit={LIMIT}
        total24={total24 ?? 0}
        errors24={errors24 ?? 0}
        filters={{ onlyErrors, search, source }}
        loadError={
          error
            ? `Não deu para ler o log (${error.message}). A tabela vem da migration 20261019120000_gss_call_log.sql — aplique no Supabase.`
            : null
        }
      />
    </div>
  );
}
