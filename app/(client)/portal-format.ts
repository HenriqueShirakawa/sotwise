/** Formatação pura do portal — sem React, usável no servidor e no cliente. */

/** "YYYY-MM-DD" → "DD/MM/YYYY", o formato de data do resto do sistema. */
export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

/** "Electronics" / "Electronics +2" — categorias do pedido em pouco espaço. */
export function categoriesText(categories: string[]): string | null {
  if (categories.length === 0) return null;
  return categories.length === 1
    ? categories[0]
    : `${categories[0]} +${categories.length - 1}`;
}
