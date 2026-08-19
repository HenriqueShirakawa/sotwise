import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";

import { CategoriesClient } from "./categories-client";

export default async function CategoriesPage() {
  await requireFeature("registration");

  const admin = createAdminClient();
  // Tudo via fetchAll: a junção cresce mais rápido que os dois cadastros que ela
  // liga, e um corte silencioso no teto de 1000 tiraria fábricas de categorias
  // (ver lib/fetch-all).
  const [categoriesRes, factoriesRes, linksRes] = await Promise.all([
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin
        .from("categories")
        .select("id, name")
        .is("deleted_at", null)
        .order("name")
        .range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin
        .from("factories")
        .select("id, name")
        .is("deleted_at", null)
        .order("name")
        .range(from, to)
    ),
    fetchAll<{ category_id: string; factory_id: string }>((from, to) =>
      admin.from("category_factories").select("category_id, factory_id").range(from, to)
    ),
  ]);

  /**
   * Registros sem nome ficam FORA da lista. São 9 categorias e algumas fábricas
   * que a migração do Bubble trouxe em branco (as tais "placeholders a revisar"
   * do dedup pós-migração): viravam linhas vazias e, porque string vazia ordena
   * primeiro, ocupavam justamente o topo da tela.
   *
   * Conferido em 2026-08-19: as 9 categorias em branco têm ZERO entradas
   * `order_factory_category` e zero vínculos — são órfãs. Continuam no banco
   * (nada aqui apaga), só não poluem a tela; se a decisão for removê-las de
   * vez, é um delete à parte.
   */
  const categories = categoriesRes.filter((c) => c.name.trim());
  const factories = factoriesRes.filter((f) => f.name.trim());
  const factoryName = new Map(factories.map((f) => [f.id, f.name]));

  const factoriesByCategory = new Map<string, string[]>();
  for (const link of linksRes) {
    if (!factoryName.has(link.factory_id)) continue; // fábrica excluída
    const list = factoriesByCategory.get(link.category_id) ?? [];
    list.push(link.factory_id);
    factoriesByCategory.set(link.category_id, list);
  }

  const rows = categories.map((c) => {
    const factoryIds = factoriesByCategory.get(c.id) ?? [];
    return {
      id: c.id,
      name: c.name,
      factory_ids: factoryIds,
      factory_names: factoryIds.map((id) => factoryName.get(id) ?? "").sort(),
    };
  });

  return <CategoriesClient data={rows} factories={factories} />;
}
