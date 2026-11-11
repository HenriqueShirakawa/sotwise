import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * City da etapa Consolidation Point (11/11/2026, card da call de 10/11, item 6):
 * Consolidation Point + City viraram uma etapa só. A cidade vem do cadastro do
 * GSS — as cidades dos produtos da fábrica (`factory_products.city_id`):
 *
 *  - fábrica com UMA cidade → ela, automática;
 *  - com várias → mantém a já escolhida se ela for uma delas; senão fica em
 *    branco para o usuário escolher;
 *  - sem nenhuma no cadastro → mantém a escolhida (o usuário escolhe na lista
 *    completa).
 */
export async function factoryCityIds(admin: Admin, factoryId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("factory_products")
    .select("city_id")
    .eq("factory_id", factoryId)
    .is("deleted_at", null)
    .not("city_id", "is", null);
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((r) => r.city_id as string))];
}

/** A City que a etapa deve ter depois de trocar o Consolidation Point. */
export async function cityForConsolidationPoint(
  admin: Admin,
  factoryId: string | null,
  currentCityId: string | null
): Promise<string | null> {
  if (!factoryId) return null;
  const cities = await factoryCityIds(admin, factoryId);
  if (cities.length === 1) return cities[0];
  if (cities.length === 0) return currentCityId;
  return currentCityId && cities.includes(currentCityId) ? currentCityId : null;
}
