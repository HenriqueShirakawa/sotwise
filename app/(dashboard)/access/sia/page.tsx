import { requireOwner } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";

import { SiaClient, type SiaUserRow } from "./sia-client";

/**
 * Tokens da SIA por usuário — owner-only, mesma porta do /access (pedido do
 * usuário em 03/11/2026). Define o limite padrão (dia e mês) e o de cada
 * usuário; a rota /api/copilot barra quem chegou no limite.
 */
export default async function SiaUsagePage() {
  await requireOwner();
  const admin = createAdminClient();

  const [profilesRes, limitsRes, totalsRes] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, status, roles(name)")
      .order("full_name")
      .returns<{ id: string; full_name: string; status: string; roles: { name: string } | null }[]>(),
    admin.from("copilot_limits").select("profile_id, daily_tokens, monthly_tokens"),
    admin.rpc("copilot_usage_totals", {}),
  ]);

  const loadError = limitsRes.error ?? totalsRes.error ?? profilesRes.error;

  const limits = limitsRes.data ?? [];
  const fallback = limits.find((l) => l.profile_id === null);
  const own = new Map(limits.filter((l) => l.profile_id).map((l) => [l.profile_id as string, l]));
  const totals = new Map((totalsRes.data ?? []).map((t) => [t.profile_id, t]));

  // Externo (papel `client`) não tem SIA — fica fora da lista.
  const rows: SiaUserRow[] = (profilesRes.data ?? [])
    .filter((p) => p.roles?.name !== "client")
    .map((p) => ({
      id: p.id,
      name: p.full_name,
      role: p.roles?.name ?? "user",
      active: p.status === "active",
      daily: own.get(p.id)?.daily_tokens ?? null,
      monthly: own.get(p.id)?.monthly_tokens ?? null,
      dayUsed: Number(totals.get(p.id)?.day_tokens ?? 0),
      monthUsed: Number(totals.get(p.id)?.month_tokens ?? 0),
    }));

  return (
    <div>
      <PageHeader
        title="SIA tokens"
        description="Quantos tokens cada usuário pode gastar na SIA por dia e por mês. Conta entrada + saída (o que a Anthropic cobra); dia e mês no fuso de São Paulo."
      />

      <SiaClient
        rows={rows}
        defaults={{ daily: fallback?.daily_tokens ?? null, monthly: fallback?.monthly_tokens ?? null }}
        loadError={
          loadError
            ? `Não deu para ler os limites (${loadError.message}). As tabelas vêm da migration 20261103160000_copilot_token_limits.sql — aplique no Supabase.`
            : null
        }
      />
    </div>
  );
}
