"use server";

import { revalidatePath } from "next/cache";

import { requireOwner } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { dailyAboveMonthly, dailyAboveMonthlyMessage, effectivePair, type LimitPair } from "@/lib/copilot/limit-rules";

const PATH = "/access/sia";

type ActionResult = { ok: true } | { ok: false; error: string };

/** null = vazio no campo; senão inteiro >= 0. */
function valid(n: number | null): boolean {
  return n === null || (Number.isSafeInteger(n) && n >= 0);
}

/** Limite padrão de todos (null = sem limite). */
export async function setDefaultLimits(daily: number | null, monthly: number | null): Promise<ActionResult> {
  const session = await requireOwner();
  if (!valid(daily) || !valid(monthly)) return { ok: false, error: "Use a whole number of tokens." };
  const fallback: LimitPair = { daily, monthly };
  if (dailyAboveMonthly(fallback)) return { ok: false, error: dailyAboveMonthlyMessage(fallback) };

  const admin = createAdminClient();

  // Quem tem só um dos dois limites próprios herda o outro do padrão: o padrão
  // novo não pode deixar o dia dessa pessoa acima do mês dela.
  const { data: own, error: ownError } = await admin
    .from("copilot_limits")
    .select("daily_tokens, monthly_tokens, profiles!copilot_limits_profile_id_fkey(full_name)")
    .not("profile_id", "is", null)
    .returns<{ daily_tokens: number | null; monthly_tokens: number | null; profiles: { full_name: string } | null }[]>();
  if (ownError) return { ok: false, error: ownError.message };
  const broken = (own ?? [])
    .filter((r) => dailyAboveMonthly(effectivePair(fallback, { daily: r.daily_tokens, monthly: r.monthly_tokens })))
    .map((r) => r.profiles?.full_name ?? "?");
  if (broken.length > 0) {
    return {
      ok: false,
      error: `Com esse padrão, o limite por dia ficaria maior que o do mês para: ${broken.join(", ")}. Ajuste o limite próprio dessas pessoas antes.`,
    };
  }

  const patch = {
    daily_tokens: daily,
    monthly_tokens: monthly,
    updated_at: new Date().toISOString(),
    updated_by: session.userId,
  };
  const { data: existing } = await admin.from("copilot_limits").select("id").is("profile_id", null).maybeSingle();
  const { error } = existing
    ? await admin.from("copilot_limits").update(patch).eq("id", existing.id)
    : await admin.from("copilot_limits").insert({ profile_id: null, ...patch });
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

/** Limite do usuário; null na coluna = herda do padrão (as duas null apaga a linha). */
export async function setUserLimits(
  profileId: string,
  daily: number | null,
  monthly: number | null
): Promise<ActionResult> {
  const session = await requireOwner();
  if (!valid(daily) || !valid(monthly)) return { ok: false, error: "Use a whole number of tokens." };

  const admin = createAdminClient();
  const { data: fallbackRow, error: fallbackError } = await admin
    .from("copilot_limits")
    .select("daily_tokens, monthly_tokens")
    .is("profile_id", null)
    .maybeSingle();
  if (fallbackError) return { ok: false, error: fallbackError.message };
  const effective = effectivePair(
    { daily: fallbackRow?.daily_tokens ?? null, monthly: fallbackRow?.monthly_tokens ?? null },
    { daily, monthly }
  );
  if (dailyAboveMonthly(effective)) return { ok: false, error: dailyAboveMonthlyMessage(effective) };

  const { error } =
    daily === null && monthly === null
      ? await admin.from("copilot_limits").delete().eq("profile_id", profileId)
      : await admin.from("copilot_limits").upsert(
          {
            profile_id: profileId,
            daily_tokens: daily,
            monthly_tokens: monthly,
            updated_at: new Date().toISOString(),
            updated_by: session.userId,
          },
          { onConflict: "profile_id" }
        );
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}
