import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";

/**
 * Fallback de `loading.tsx` para as telas de listagem pesadas (Orders, ETD
 * Factories). Espelha a estrutura da página — cabeçalho, toolbar e tabela —
 * para dar feedback imediato na navegação enquanto o server component busca os
 * dados. A sidebar (no layout) permanece; só esta área de conteúdo é trocada.
 */
export function TablePageSkeleton({
  columns = 8,
  rows = 8,
}: {
  columns?: number;
  rows?: number;
}) {
  const cols = Array.from({ length: columns });
  return (
    <div>
      {/* Cabeçalho: título + descrição + ação */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-11 w-36 rounded-xl" />
      </div>

      {/* Toolbar: busca + filtros */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Skeleton className="h-11 w-full max-w-sm rounded-xl" />
        <Skeleton className="h-11 w-32 rounded-xl" />
      </div>

      {/* Tabela */}
      <div className="overflow-hidden rounded-2xl border bg-white">
        <div className="flex gap-4 border-b bg-slate-50/80 px-4 py-4">
          {cols.map((_, i) => (
            <Skeleton key={i} className="h-4 flex-1" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-4 border-b px-4 py-4 last:border-b-0">
            {cols.map((_, c) => (
              <Skeleton key={c} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Linhas fantasma no lugar das linhas da tabela enquanto a lista paginada no
 * servidor busca outra página/filtro/ordem — o usuário prefere ver o esqueleto
 * na hora a ficar olhando a página velha esperando (29/10/2026).
 */
export function TableRowsSkeleton({ columns, rows }: { columns: number; rows: number }) {
  return Array.from({ length: rows }).map((_, r) => (
    <TableRow key={r} className="hover:bg-transparent">
      {Array.from({ length: columns }).map((_, c) => (
        <TableCell key={c} className="px-4">
          <Skeleton className="h-4 w-full min-w-12" />
        </TableCell>
      ))}
    </TableRow>
  ));
}

/** O mesmo para os cards da tela estreita (abaixo de 720px, ver DataCards). */
export function CardsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3 min-[720px]:hidden">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="space-y-2 rounded-2xl border bg-white p-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
}
