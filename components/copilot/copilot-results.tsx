"use client";

import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import type { CopilotResult } from "@/lib/copilot/use-copilot";

/**
 * Renderiza o resultado de UMA ferramenta como linhas clicáveis do SOT
 * (docs/regras_de_negocio.md §6.1). É o que separa o copilot de um chat: o dado
 * volta como linha navegável, não como texto.
 *
 * As colunas saem das chaves que a ferramenta já devolve — a ferramenta é quem
 * curou o que importa (PO, status, dias de atraso…), então não há o que escolher
 * aqui. `id`/`order_id`/`pre_loading_id` são só para o link e ficam ocultos.
 */

type Row = Record<string, unknown>;

type Section = { rowsKey: string; title: string; href: (row: Row) => string | null };

/**
 * Ferramentas que viram tabela, com onde estão as linhas e para onde a linha
 * leva. Uma ferramenta pode render mais de uma tabela: `trace_chain` devolve a
 * cadeia (um lote por linha) e as entradas Factory×Category daqueles lotes —
 * são dois níveis diferentes, e achatar num só perderia a leitura.
 */
const KINDS: Record<string, Section[]> = {
  search_orders: [
    { rowsKey: "orders", title: "Orders", href: (r) => (r.id ? `/orders/${r.id}` : null) },
  ],
  list_etd_entries: [
    {
      rowsKey: "entries",
      title: "ETD Factories",
      href: (r) => (r.order_id ? `/orders/${r.order_id}` : null),
    },
  ],
  list_pre_loadings: [
    {
      rowsKey: "pre_loadings",
      title: "Pre-loading",
      href: (r) => (r.id ? `/pre-loading/${r.id}` : null),
    },
  ],
  search_shipments: [
    { rowsKey: "shipments", title: "Shipments", href: (r) => (r.id ? `/shipments/${r.id}` : null) },
  ],
  trace_chain: [
    {
      rowsKey: "chain",
      title: "Order → batch → PL → shipment",
      // A linha leva para a Order: é o começo da cadeia e de lá se navega para
      // o resto. O PL tem sua própria coluna, clicável pela tabela de baixo.
      href: (r) => (r.order_id ? `/orders/${r.order_id}` : null),
    },
    {
      rowsKey: "entries",
      title: "Factory × Category",
      href: (r) => (r.order_id ? `/orders/${r.order_id}` : null),
    },
  ],
  list_pending_steps: [
    {
      rowsKey: "steps",
      title: "Pending steps",
      href: (r) =>
        r.order_id
          ? `/orders/${r.order_id}`
          : r.pre_loading_id
            ? `/pre-loading/${r.pre_loading_id}`
            : null,
    },
  ],
};

/** Colunas que só existem para montar o link — nunca aparecem. */
const HIDDEN = new Set(["id", "order_id", "pre_loading_id"]);

function label(key: string): string {
  return key.replace(/_/g, " ");
}

function cell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "✓" : "—";
  return String(value);
}

export function CopilotResults({ tool, result }: CopilotResult) {
  const sections = KINDS[tool];
  if (!sections) return null;

  return (
    <>
      {sections.map((section, i) => (
        <ResultTable
          key={section.rowsKey}
          section={section}
          result={result}
          // `total_matched` descreve a consulta principal. Numa tabela derivada
          // (as entradas dos lotes já paginados) ele contaria outra coisa.
          showTotal={i === 0}
        />
      ))}
    </>
  );
}

function ResultTable({
  section,
  result,
  showTotal,
}: {
  section: Section;
  result: unknown;
  showTotal: boolean;
}) {
  const router = useRouter();

  const rows = (result as Record<string, unknown>)?.[section.rowsKey];
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const columns = Object.keys(rows[0] as Row).filter((k) => !HIDDEN.has(k));
  const total = showTotal
    ? ((result as { total_matched?: number }).total_matched ?? rows.length)
    : rows.length;

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
        <span>{section.title}</span>
        <span>{total > rows.length ? `${rows.length} of ${total}` : rows.length}</span>
      </div>
      <div className="max-h-72 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-background">
            <tr className="text-left text-muted-foreground">
              {columns.map((c) => (
                <th key={c} className="whitespace-nowrap px-3 py-1.5 font-medium capitalize">
                  {label(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(rows as Row[]).map((row, i) => {
              const href = section.href(row);
              return (
                <tr
                  key={i}
                  onClick={href ? () => router.push(href) : undefined}
                  className={cn(
                    "border-t",
                    href && "cursor-pointer hover:bg-muted/60"
                  )}
                >
                  {columns.map((c) => (
                    <td key={c} className="whitespace-nowrap px-3 py-1.5">
                      {cell(row[c])}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
