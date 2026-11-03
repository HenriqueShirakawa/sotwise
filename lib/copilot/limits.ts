import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Limite de tokens da SIA por usuário, por dia e por mês (docs/regras_de_negocio.md
 * §6.1, 03/11/2026). O owner define na tela /access/sia; a rota da SIA consulta
 * antes de chamar o modelo e grava o gasto de cada pergunta em `copilot_usage`.
 *
 * Conta entrada + saída + cache — o que a Anthropic cobra. Dia e mês no fuso de
 * São Paulo (função `copilot_usage_totals`). `null` no limite = sem limite.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type CopilotLimits = { daily: number | null; monthly: number | null };

export type CopilotQuota = {
  limits: CopilotLimits;
  dayUsed: number;
  monthUsed: number;
};

/** Gasto de uma pergunta (soma das voltas do modelo). */
export type CopilotSpend = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
};

export const EMPTY_SPEND: CopilotSpend = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

export function spendTotal(s: CopilotSpend): number {
  return s.input + s.output + s.cacheRead + s.cacheCreation;
}

/** O do usuário vale coluna a coluna; `null` na coluna herda do padrão. */
export function effectiveLimits(
  fallback: CopilotLimits,
  own: { daily_tokens: number | null; monthly_tokens: number | null } | null | undefined
): CopilotLimits {
  return {
    daily: own?.daily_tokens ?? fallback.daily,
    monthly: own?.monthly_tokens ?? fallback.monthly,
  };
}

export async function getCopilotQuota(admin: Admin, profileId: string): Promise<CopilotQuota> {
  const [limitsRes, totalsRes] = await Promise.all([
    admin
      .from("copilot_limits")
      .select("profile_id, daily_tokens, monthly_tokens")
      .or(`profile_id.is.null,profile_id.eq.${profileId}`),
    admin.rpc("copilot_usage_totals", { p_profile_id: profileId }),
  ]);
  if (limitsRes.error) throw new Error(limitsRes.error.message);
  if (totalsRes.error) throw new Error(totalsRes.error.message);

  const rows = limitsRes.data ?? [];
  const fallbackRow = rows.find((r) => r.profile_id === null);
  const fallback: CopilotLimits = {
    daily: fallbackRow?.daily_tokens ?? null,
    monthly: fallbackRow?.monthly_tokens ?? null,
  };
  const totals = totalsRes.data?.[0];
  return {
    limits: effectiveLimits(fallback, rows.find((r) => r.profile_id === profileId)),
    dayUsed: Number(totals?.day_tokens ?? 0),
    monthUsed: Number(totals?.month_tokens ?? 0),
  };
}

/**
 * Mensagem para o usuário quando o limite já foi atingido (com `extra` tokens
 * ainda não gravados, da pergunta em andamento); `null` = pode seguir.
 */
export function quotaBlockMessage(q: CopilotQuota, extra = 0): string | null {
  const fmt = (n: number) => n.toLocaleString("en-US");
  if (q.limits.daily !== null && q.dayUsed + extra >= q.limits.daily) {
    return `You've reached your SIA limit for today (${fmt(q.limits.daily)} tokens). It resets at midnight (São Paulo time).`;
  }
  if (q.limits.monthly !== null && q.monthUsed + extra >= q.limits.monthly) {
    return `You've reached your SIA limit for this month (${fmt(q.limits.monthly)} tokens). It resets on the 1st.`;
  }
  return null;
}

export async function recordCopilotUsage(
  admin: Admin,
  profileId: string,
  spend: CopilotSpend,
  model: string
): Promise<void> {
  if (spendTotal(spend) === 0) return;
  const { error } = await admin.from("copilot_usage").insert({
    profile_id: profileId,
    input_tokens: spend.input,
    output_tokens: spend.output,
    cache_read_tokens: spend.cacheRead,
    cache_creation_tokens: spend.cacheCreation,
    model,
  });
  // A resposta já foi entregue; perder a linha só afrouxa o limite desta vez.
  if (error) console.error("[copilot] usage not recorded:", error.message);
}
