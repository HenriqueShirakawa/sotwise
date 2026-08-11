"use server";

import { revalidatePath } from "next/cache";

import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  agentSchema,
  type ActionResult,
  type AgentInput,
} from "@/domain/registration/schema";

const PATH = "/registration/agents";

function toRow(input: AgentInput) {
  return {
    name: input.name,
    country_id: input.country_id,
    location: input.location,
    email: input.email_na ? null : input.email,
    email_na: input.email_na,
    phone_number: input.phone_number,
  };
}

/** Regrava a junção M-N `agent_contacts` (apaga e insere — a lista é pequena). */
async function syncContacts(
  admin: ReturnType<typeof createAdminClient>,
  agentId: string,
  contactIds: string[]
): Promise<string | null> {
  const { error: delError } = await admin
    .from("agent_contacts")
    .delete()
    .eq("agent_id", agentId);
  if (delError) return delError.message;

  if (contactIds.length === 0) return null;

  const { error } = await admin
    .from("agent_contacts")
    .insert(contactIds.map((contact_id) => ({ agent_id: agentId, contact_id })));
  return error?.message ?? null;
}

export async function createAgent(input: AgentInput): Promise<ActionResult> {
  const session = await requireFeature("registration", "create");

  const parsed = agentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("agents")
    .insert({ ...toRow(parsed.data), created_by: session.userId })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create the agent." };

  const linkError = await syncContacts(admin, data.id, parsed.data.contact_ids);
  if (linkError) return { ok: false, error: linkError };

  revalidatePath(PATH);
  return { ok: true };
}

export async function updateAgent(id: string, input: AgentInput): Promise<ActionResult> {
  await requireFeature("registration", "edit");

  const parsed = agentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("agents").update(toRow(parsed.data)).eq("id", id);
  if (error) return { ok: false, error: error.message };

  const linkError = await syncContacts(admin, id, parsed.data.contact_ids);
  if (linkError) return { ok: false, error: linkError };

  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteAgent(id: string): Promise<ActionResult> {
  await requireFeature("registration", "delete");

  const admin = createAdminClient();
  const { error } = await admin
    .from("agents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}
