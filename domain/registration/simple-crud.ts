import "server-only";

import { revalidatePath } from "next/cache";

import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { bulkNamesSchema, nameSchema, type ActionResult } from "./schema";

/**
 * CRUD genérico para os cadastros "name-only" (Carriers, POL, POD, Countries,
 * Order Type, Shipment Models). A tabela é sempre passada pelo `actions.ts` da
 * tela (código de servidor) — NUNCA vem do client —, então a união abaixo é a
 * allowlist de segurança. Soft-delete e verifySession seguem o padrão de
 * factories/clients (docs §12.9).
 */
export type SimpleTable =
  | "carriers"
  | "cities"
  | "pols"
  | "pods"
  | "countries"
  | "order_types"
  | "shipment_models";

/** Tabelas que têm coluna `created_by` (as demais não têm — ver types/database.ts). */
const HAS_CREATED_BY: Record<SimpleTable, boolean> = {
  carriers: true,
  order_types: true,
  shipment_models: true,
  cities: false,
  pols: false,
  pods: false,
  countries: false,
};

/**
 * `%` e `_` são curingas no ilike — sem escapar, um nome com "%" casaria com
 * meia tabela e barraria criação legítima. A barra invertida é o escape do
 * Postgres e precisa vir primeiro.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Nomes já usados na tabela, comparados sem diferenciar maiúsculas. Ignora os
 * soft-deleted: um registro removido não deve bloquear a recriação do nome.
 * Sem isso os cadastros aceitavam duplicata silenciosamente — foi assim que
 * "Chongqing" acabou 4x no POL.
 */
async function findExistingNames(
  admin: ReturnType<typeof createAdminClient>,
  table: SimpleTable,
  names: string[],
  ignoreId?: string
): Promise<Set<string>> {
  const taken = new Set<string>();

  for (const name of names) {
    let query = admin
      .from(table)
      .select("id, name")
      .is("deleted_at", null)
      .ilike("name", escapeLike(name));
    if (ignoreId) query = query.neq("id", ignoreId);

    const { data } = await query.limit(1);
    if (data?.length) taken.add(name.toLowerCase());
  }

  return taken;
}

export async function createSimpleNames(
  table: SimpleTable,
  path: string,
  names: string[]
): Promise<ActionResult> {
  const session = await requireFeature("registration", "create");

  const parsed = bulkNamesSchema.safeParse({ names });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();

  // Duplicata dentro do próprio lote (o form aceita várias linhas de uma vez).
  const seen = new Set<string>();
  for (const name of parsed.data.names) {
    const key = name.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, error: `"${name}" is repeated in this list.` };
    }
    seen.add(key);
  }

  const taken = await findExistingNames(admin, table, parsed.data.names);
  if (taken.size) {
    const first = parsed.data.names.find((n) => taken.has(n.toLowerCase()));
    return { ok: false, error: `"${first}" already exists.` };
  }

  const rows = parsed.data.names.map((name) =>
    HAS_CREATED_BY[table] ? { name, created_by: session.userId } : { name }
  );
  const { error } = await admin.from(table).insert(rows as never);
  if (error) return { ok: false, error: error.message };

  revalidatePath(path);
  return { ok: true };
}

export async function updateSimpleName(
  table: SimpleTable,
  path: string,
  id: string,
  name: string
): Promise<ActionResult> {
  await requireFeature("registration", "edit");

  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid name." };
  }

  const admin = createAdminClient();

  // `ignoreId` = o próprio registro: renomear "Chongqing" para "Chongqing" (ou
  // só trocar a caixa) não pode colidir consigo mesmo.
  const taken = await findExistingNames(admin, table, [parsed.data], id);
  if (taken.size) {
    return { ok: false, error: `"${parsed.data}" already exists.` };
  }

  const { error } = await admin
    .from(table)
    .update({ name: parsed.data } as never)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(path);
  return { ok: true };
}

/** Soft delete: some das listagens, preserva histórico. */
export async function deleteSimple(
  table: SimpleTable,
  path: string,
  id: string
): Promise<ActionResult> {
  await requireFeature("registration", "delete");

  const admin = createAdminClient();
  const { error } = await admin
    .from(table)
    .update({ deleted_at: new Date().toISOString() } as never)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(path);
  return { ok: true };
}
