"use server";

import { revalidatePath } from "next/cache";

import { verifySession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  clientSchema,
  type ActionResult,
  type ClientInput,
} from "@/domain/registration/schema";

const PATH = "/registration/clients";

export async function createClientRecord(
  input: ClientInput
): Promise<ActionResult> {
  const session = await verifySession();

  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("clients").insert({
    name: parsed.data.name,
    country_id: parsed.data.country_id,
    created_by: session.userId,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

export async function updateClientRecord(
  id: string,
  input: ClientInput
): Promise<ActionResult> {
  await verifySession();

  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("clients")
    .update({ name: parsed.data.name, country_id: parsed.data.country_id })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteClientRecord(id: string): Promise<ActionResult> {
  await verifySession();

  const admin = createAdminClient();
  const { error } = await admin
    .from("clients")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}
