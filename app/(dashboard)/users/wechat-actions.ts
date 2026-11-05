"use server";

import { revalidatePath } from "next/cache";

import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * WeChat em Users → Edit: o admin só DESVINCULA (ex.: pessoa saiu, trocou de
 * celular). Vincular é da própria pessoa, em My profile
 * (`app/(dashboard)/profile/wechat-actions.ts`).
 */
export async function unlinkWechat(userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireFeature("users", "edit");
  const { error } = await createAdminClient()
    .from("profiles")
    .update({ wechat_openid: null, wechat_nickname: null, wechat_avatar_url: null })
    .eq("id", userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/users");
  return { ok: true };
}
