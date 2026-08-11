"use server";

import { revalidatePath } from "next/cache";

import { requireOwner } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  FEATURES,
  GRANT_COLUMN,
  isFeatureKey,
  type FeatureAction,
  type FeatureKey,
} from "@/domain/access/features";
import type { TablesInsert } from "@/types/database";

const PATH = "/access";

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Valida o par (feature, ação) contra o CATÁLOGO antes de gravar. Sem isso, a
 * tabela aceitaria `feature_key` inventada ou ação que a feature não expõe —
 * linha morta que ninguém lê mas que confunde a auditoria. Feature owner-only
 * também não é concedível a ninguém.
 */
function validate(
  feature: string,
  action: FeatureAction
): { ok: true; key: FeatureKey } | { ok: false; error: string } {
  if (!isFeatureKey(feature)) return { ok: false, error: `Unknown feature '${feature}'.` };

  const def = FEATURES[feature];
  if ("ownerOnly" in def && def.ownerOnly) {
    return { ok: false, error: `'${def.label}' is reserved for the owner.` };
  }
  if (!(def.actions as readonly string[]).includes(action)) {
    return { ok: false, error: `'${def.label}' has no '${action}' action.` };
  }

  return { ok: true, key: feature };
}

/** Liga/desliga uma ação de uma feature para um PAPEL (o padrão herdado). */
export async function setRoleFeature(
  roleId: string,
  feature: string,
  action: FeatureAction,
  value: boolean
): Promise<ActionResult> {
  await requireOwner();

  const checked = validate(feature, action);
  if (!checked.ok) return checked;

  const admin = createAdminClient();

  // O papel `owner` não tem linha nenhuma (bypass em código) — deixar gravar
  // aqui daria a falsa impressão de que dá para restringi-lo pela tela.
  const { data: role } = await admin.from("roles").select("name").eq("id", roleId).single();
  if (!role) return { ok: false, error: "Role not found." };
  if (role.name === "owner") {
    return { ok: false, error: "The owner role always has full access." };
  }

  // Montado em duas etapas: chave computada dentro do literal viraria index
  // signature e o tipo gerado do Supabase rejeita.
  const row: TablesInsert<"role_features"> = { role_id: roleId, feature_key: checked.key };
  row[GRANT_COLUMN[action]] = value;

  const { error } = await admin
    .from("role_features")
    .upsert(row, { onConflict: "role_id,feature_key" });
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Exceção individual. `value` tri-estado: `true`/`false` sobrepõem o papel,
 * `null` remove o override e devolve o usuário à herança.
 */
export async function setUserFeature(
  userId: string,
  feature: string,
  action: FeatureAction,
  value: boolean | null
): Promise<ActionResult> {
  const session = await requireOwner();

  const checked = validate(feature, action);
  if (!checked.ok) return checked;

  // Um owner revogando a própria feature `access` se trancaria fora da tela —
  // e como `access` é owner-only, o override nem teria efeito. Barrado por
  // clareza, junto com qualquer auto-restrição.
  if (userId === session.userId) {
    return { ok: false, error: "You cannot change your own access." };
  }

  const admin = createAdminClient();

  const row: TablesInsert<"user_features"> = { user_id: userId, feature_key: checked.key };
  row[GRANT_COLUMN[action]] = value;

  const { error } = await admin
    .from("user_features")
    .upsert(row, { onConflict: "user_id,feature_key" });
  if (error) return { ok: false, error: error.message };

  // Linha que voltou a ser toda `null` não significa nada — limpa para a
  // listagem de exceções não encher de ruído.
  const { data: saved } = await admin
    .from("user_features")
    .select("can_view, can_create, can_edit, can_delete")
    .eq("user_id", userId)
    .eq("feature_key", checked.key)
    .maybeSingle();

  if (saved && Object.values(saved).every((v) => v === null)) {
    await admin
      .from("user_features")
      .delete()
      .eq("user_id", userId)
      .eq("feature_key", checked.key);
  }

  revalidatePath(PATH);
  return { ok: true };
}
