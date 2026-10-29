/**
 * Teto de linhas que o PostgREST devolve num request. Passar disso não dá erro:
 * a resposta simplesmente vem cortada, sem aviso nenhum — daí a paginação.
 */
const PAGE = 1000;
/** Páginas pedidas juntas a cada rodada depois da primeira. */
const PARALLEL = 4;

/**
 * Busca TODAS as linhas de uma query, paginando em blocos de 1000.
 *
 * Vale para qualquer listagem que possa crescer, mas é especialmente importante
 * nos cadastros que alimentam os campos de busca (fábricas, contatos, clientes…)
 * e nas tabelas de vínculo (`category_factories`, `agent_contacts`): ali um corte
 * silencioso vira "a opção não existe" para quem usa a tela.
 *
 * O `build` recebe o intervalo e deve devolver a query já com `.range(from, to)`.
 */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>
): Promise<T[]> {
  const { data: first } = await build(0, PAGE - 1);
  const all: T[] = [...(first ?? [])];
  // Tabela grande (ex.: cities, ~8 mil): as páginas seguintes saem em rodadas
  // paralelas, em vez de uma ida ao banco por vez.
  for (let from = PAGE; all.length === from; from += PAGE * PARALLEL) {
    const chunks = await Promise.all(
      Array.from({ length: PARALLEL }, (_, i) => {
        const start = from + i * PAGE;
        return build(start, start + PAGE - 1);
      })
    );
    for (const { data } of chunks) {
      const chunk = data ?? [];
      all.push(...chunk);
      if (chunk.length < PAGE) return all;
    }
  }
  return all;
}
