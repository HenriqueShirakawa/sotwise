"use server";

import { revalidatePath } from "next/cache";

import { verifySession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  profileSelfUpdateSchema,
  type ActionResult,
  type ProfileSelfUpdateInput,
} from "@/domain/users/schema";

const PATH = "/profile";

/**
 * Edita o próprio perfil (§3.1). `verifySession` em vez de `requireAdmin`: aqui
 * qualquer usuário mexe no que é dele. O id vem SEMPRE da sessão, nunca do
 * cliente — senão daria para editar o perfil alheio mandando outro id.
 */
export async function updateMyProfile(
  input: ProfileSelfUpdateInput
): Promise<ActionResult> {
  const session = await verifySession();

  const parsed = profileSelfUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({
      full_name: parsed.data.full_name,
      date_of_birth: parsed.data.date_of_birth,
    })
    .eq("id", session.userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}
