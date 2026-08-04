/**
 * Fábricas oferecidas para a categoria escolhida — o vínculo Factory × Category
 * de `category_factories` (docs/regras_de_negocio.md §3.5.2).
 *
 * Sem categoria selecionada, ou categoria sem nenhum vínculo cadastrado,
 * devolve a lista inteira: filtrar para vazio deixaria o usuário sem como
 * cadastrar a entrada quando o vínculo ainda não foi preenchido.
 */
export function factoriesForCategory<T extends { id: string }>(
  factories: T[],
  categoryId: string,
  factoriesByCategory: Record<string, string[]>
): T[] {
  const allowed = categoryId ? factoriesByCategory[categoryId] : undefined;
  if (!allowed?.length) return factories;
  const allowedSet = new Set(allowed);
  return factories.filter((f) => allowedSet.has(f.id));
}
