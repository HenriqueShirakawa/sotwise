"use server";

import { revalidatePath } from "next/cache";

import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  contactSchema,
  type ActionResult,
  type ContactInput,
} from "@/domain/registration/schema";

const PATH = "/registration/contacts";

/** `email_na` marcado zera o e-mail — a doc §3.5.3 trata "N/A" como ausência. */
function toRow(input: ContactInput) {
  return {
    name: input.name,
    email: input.email_na ? null : input.email,
    email_na: input.email_na,
    phone_number: input.phone_number,
  };
}

export async function createContact(input: ContactInput): Promise<ActionResult> {
  const session = await requireFeature("registration", "create");

  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("contacts")
    .insert({ ...toRow(parsed.data), created_by: session.userId });
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

export async function updateContact(id: string, input: ContactInput): Promise<ActionResult> {
  await requireFeature("registration", "edit");

  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("contacts").update(toRow(parsed.data)).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteContact(id: string): Promise<ActionResult> {
  await requireFeature("registration", "delete");

  const admin = createAdminClient();
  const { error } = await admin
    .from("contacts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}
