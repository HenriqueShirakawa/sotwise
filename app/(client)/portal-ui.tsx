import { cn } from "@/lib/utils";

/**
 * Peças de apresentação compartilhadas pelas telas do portal (Dashboard, My
 * orders). Sem estado e sem dado próprio — o recorte do que o cliente vê é
 * decidido em domain/client/portal.ts.
 */

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

export function itemsText(count: number): string {
  return `${count} ${count === 1 ? "product" : "products"}`;
}

/** Barra fina + "%" — progresso do pedido pelos lotes (ver `progressPct`). */
export function ProgressBar({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-slate-200"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 text-xs text-slate-500 tabular-nums">{pct}%</span>
    </div>
  );
}
