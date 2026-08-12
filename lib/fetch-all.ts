/**
 * Teto de linhas que o PostgREST devolve num request. Passar disso não dá erro:
 * a resposta simplesmente vem cortada, sem aviso nenhum — daí a paginação.
 */
const PAGE = 1000;

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
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await build(from, from + PAGE - 1);
    const chunk = data ?? [];
    all.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return all;
}
