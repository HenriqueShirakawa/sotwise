"use server";

import { revalidatePath } from "next/cache";

import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  categoryFormSchema,
  type ActionResult,
  type CategoryFormInput,
} from "@/domain/registration/schema";

const PATH = "/registration/categories";

/**
 * Regrava a junção M-N `category_factories` (apaga e insere — a lista é
 * pequena). Mesmo padrão do `syncContacts` de agents; a tabela não tem id
 * próprio, então não há o que atualizar linha a linha.
 */
async function syncFactories(
  admin: ReturnType<typeof createAdminClient>,
  categoryId: string,
  factoryIds: string[]
): Promise<string | null> {
  const { error: delError } = await admin
    .from("category_factories")
    .delete()
    .eq("category_id", categoryId);
  if (delError) return delError.message;

  if (factoryIds.length === 0) return null;

  const { error } = await admin
    .from("category_factories")
    .insert(factoryIds.map((factory_id) => ({ category_id: categoryId, factory_id })));
  return error?.message ?? null;
}

export async function createCategory(input: CategoryFormInput): Promise<ActionResult> {
  const session = await requireFeature("registration", "create");

  const parsed = categoryFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("categories")
    .insert({ name: parsed.data.name, created_by: session.userId })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not create the category." };
  }

  const linkError = await syncFactories(admin, data.id, parsed.data.factory_ids);
  if (linkError) return { ok: false, error: linkError };

  revalidatePath(PATH);
  return { ok: true };
}

export async function updateCategory(
  id: string,
  input: CategoryFormInput
): Promise<ActionResult> {
  await requireFeature("registration", "edit");

  const parsed = categoryFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("categories")
    .update({ name: parsed.data.name })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  const linkError = await syncFactories(admin, id, parsed.data.factory_ids);
  if (linkError) return { ok: false, error: linkError };

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Soft delete, como o resto dos cadastros. O vínculo em `category_factories`
 * fica: a categoria continua existindo (só some das listagens) e as entradas
 * `order_factory_category` que a referenciam seguem íntegras — apagar a junção
 * aqui deixaria pedido antigo sem a fábrica da sua própria categoria.
 */
export async function deleteCategory(id: string): Promise<ActionResult> {
  await requireFeature("registration", "delete");

  const admin = createAdminClient();
  const { error } = await admin
    .from("categories")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}
