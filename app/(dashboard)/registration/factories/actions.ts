"use server";

import { revalidatePath } from "next/cache";

import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  bulkNamesSchema,
  nameSchema,
  type ActionResult,
} from "@/domain/registration/schema";

const PATH = "/registration/factories";

/** Cria uma ou várias factories (criação em lote). */
export async function createFactories(names: string[]): Promise<ActionResult> {
  const session = await requireFeature("registration", "create");

  const parsed = bulkNamesSchema.safeParse({ names });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();
  const rows = parsed.data.names.map((name) => ({
    name,
    created_by: session.userId,
  }));
  const { error } = await admin.from("factories").insert(rows);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

export async function updateFactory(
  id: string,
  name: string
): Promise<ActionResult> {
  await requireFeature("registration", "edit");

  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid name." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("factories")
    .update({ name: parsed.data })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

/** Soft delete: some das listagens, preserva histórico (§ convenções). */
export async function deleteFactory(id: string): Promise<ActionResult> {
  await requireFeature("registration", "delete");

  const admin = createAdminClient();
  const { error } = await admin
    .from("factories")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}
