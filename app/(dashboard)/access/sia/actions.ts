"use server";

import { revalidatePath } from "next/cache";

import { requireOwner } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";

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

  const admin = createAdminClient();
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
