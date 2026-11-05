"use server";

import { revalidatePath } from "next/cache";

import { markSupportRead, sendSupportMessage } from "@/domain/support/chat";
import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true } | { ok: false; error: string };

async function clientExists(clientId: string) {
  const { data } = await createAdminClient()
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .is("deleted_at", null)
    .maybeSingle();
  return !!data;
}

/** Resposta do time interno na thread do cliente (feature `support`/create). */
export async function sendInternalSupportMessage(clientId: string, body: string): Promise<Result> {
  const session = await requireFeature("support", "create");
  if (!(await clientExists(clientId))) return { ok: false, error: "Client not found." };
  const res = await sendSupportMessage({ clientId, authorId: session.userId, body });
  if (res.ok) revalidatePath("/support");
  return res;
}

export async function markInternalSupportRead(clientId: string): Promise<void> {
  const session = await requireFeature("support");
  await markSupportRead(clientId, session.userId);
  revalidatePath("/support");
}
