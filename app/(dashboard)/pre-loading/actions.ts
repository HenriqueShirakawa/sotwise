"use server";

import { revalidatePath } from "next/cache";

import { verifySession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";

const PATH = "/pre-loading";

type ActionResult = { ok: true } | { ok: false; error: string };

export async function deletePreLoading(id: string): Promise<ActionResult> {
  await verifySession();

  const admin = createAdminClient();
  const { error } = await admin
    .from("pre_loadings")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}
