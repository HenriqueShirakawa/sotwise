"use server";

import { revalidatePath } from "next/cache";

import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  exporterSchema,
  type ActionResult,
  type ExporterInput,
} from "@/domain/registration/schema";

const PATH = "/registration/exporters";

/**
 * `%` e `_` são curingas no ilike — sem escapar, um nome com "%" casaria com
 * meia tabela e barraria criação legítima (mesmo cuidado do simple-crud).
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Duplicata de nome, sem diferenciar maiúsculas e ignorando os soft-deleted —
 * um registro removido não deve bloquear a recriação do nome. Mesma checagem dos
 * cadastros name-only: sem ela, "Chongqing" acabou 4x no POL.
 */
async function nameTaken(
  admin: ReturnType<typeof createAdminClient>,
  name: string,
  ignoreId?: string
): Promise<boolean> {
  let query = admin
    .from("exporters")
    .select("id")
    .is("deleted_at", null)
    .ilike("name", escapeLike(name));
  if (ignoreId) query = query.neq("id", ignoreId);

  const { data } = await query.limit(1);
  return Boolean(data?.length);
}

export async function createExporter(input: ExporterInput): Promise<ActionResult> {
  const session = await requireFeature("registration", "create");

  const parsed = exporterSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();
  if (await nameTaken(admin, parsed.data.name)) {
    return { ok: false, error: `"${parsed.data.name}" already exists.` };
  }

  const { error } = await admin.from("exporters").insert({
    name: parsed.data.name,
    acronym: parsed.data.acronym,
    created_by: session.userId,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

export async function updateExporter(
  id: string,
  input: ExporterInput
): Promise<ActionResult> {
  await requireFeature("registration", "edit");

  const parsed = exporterSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();
  if (await nameTaken(admin, parsed.data.name, id)) {
    return { ok: false, error: `"${parsed.data.name}" already exists.` };
  }

  const { error } = await admin
    .from("exporters")
    .update({ name: parsed.data.name, acronym: parsed.data.acronym })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

/** Soft delete: pedidos que já apontam para o exporter seguem íntegros. */
export async function deleteExporter(id: string): Promise<ActionResult> {
  await requireFeature("registration", "delete");

  const admin = createAdminClient();
  const { error } = await admin
    .from("exporters")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}
