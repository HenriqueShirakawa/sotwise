import "server-only";

import { revalidatePath } from "next/cache";

import { verifySession } from "@/lib/dal";
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
  pols: false,
  pods: false,
  countries: false,
};

export async function createSimpleNames(
  table: SimpleTable,
  path: string,
  names: string[]
): Promise<ActionResult> {
  const session = await verifySession();

  const parsed = bulkNamesSchema.safeParse({ names });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();
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
  await verifySession();

  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid name." };
  }

  const admin = createAdminClient();
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
  await verifySession();

  const admin = createAdminClient();
  const { error } = await admin
    .from(table)
    .update({ deleted_at: new Date().toISOString() } as never)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(path);
  return { ok: true };
}
