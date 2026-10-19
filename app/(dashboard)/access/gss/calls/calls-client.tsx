"use client";

import { Fragment, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, RefreshCw, Search, TriangleAlert } from "lucide-react";

export type CallRow = {
  id: number;
  createdAt: string;
  method: string;
  path: string;
  status: number;
  kind: string;
  durationMs: number | null;
  requestBody: unknown;
  responseBody: string | null;
  error: string | null;
  source: string | null;
  ref: string | null;
  origin: string;
};

const SOURCES = [
  { value: "", label: "Todas as origens" },
  { value: "pl-shipment", label: "PL / Shipment" },
  { value: "batch-status", label: "Status do lote" },
  { value: "etd-factory", label: "ETD Factories" },
];

function when(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Corpo legível: JSON indentado quando dá, texto cru quando não. */
function pretty(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

function StatusChip({ status, kind }: { status: number; kind: string }) {
  const ok = kind === "ok";
  const cls = ok
    ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900"
    : "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900";
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-xs tabular-nums ${cls}`}>
      {status === 0 ? "—" : status}
      {!ok && <span className="ml-1 font-sans">{kind}</span>}
    </span>
  );
}

function Counter({ value, label, alert }: { value: number; label: string; alert?: boolean }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className={`text-2xl font-semibold tabular-nums ${alert && value > 0 ? "text-red-600" : ""}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function CallsClient({
  rows,
  limit,
  total24,
  errors24,
  filters,
  loadError,
}: {
  rows: CallRow[];
  limit: number;
  total24: number;
  errors24: number;
  filters: { onlyErrors: boolean; search: string; source: string };
  loadError: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState<number | null>(null);
  const [search, setSearch] = useState(filters.search);

  function go(next: Partial<{ onlyErrors: boolean; search: string; source: string }>) {
    const f = { ...filters, ...next };
    const params = new URLSearchParams();
    if (f.onlyErrors) params.set("f", "erros");
    if (f.search) params.set("q", f.search);
    if (f.source) params.set("s", f.source);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="space-y-4">
      {loadError && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {loadError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <Counter value={total24} label="chamadas nas últimas 24 h" />
        <Counter value={errors24} label="com erro nas últimas 24 h" alert />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border p-0.5 text-sm">
          <button
            type="button"
            onClick={() => go({ onlyErrors: false })}
            className={`rounded-md px-3 py-1 ${!filters.onlyErrors ? "bg-muted font-medium" : "text-muted-foreground"}`}
          >
            Todas
          </button>
          <button
            type="button"
            onClick={() => go({ onlyErrors: true })}
            className={`rounded-md px-3 py-1 ${filters.onlyErrors ? "bg-muted font-medium" : "text-muted-foreground"}`}
          >
            Só erros
          </button>
        </div>

        <select
          value={filters.source}
          onChange={(e) => go({ source: e.target.value })}
          className="h-8 rounded-lg border bg-background px-2 text-sm"
          aria-label="Origem"
        >
          {SOURCES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            go({ search: search.trim() });
          }}
          className="relative"
        >
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="PL 1470, 1705.01, /shipments/…"
            className="h-8 w-64 max-w-full rounded-lg border bg-background pl-8 pr-2 text-sm"
          />
        </form>

        <button
          type="button"
          onClick={() => router.refresh()}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm text-muted-foreground hover:bg-muted"
        >
          <RefreshCw className="size-3.5" />
          Atualizar
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-6 px-2 py-2" />
              <th className="px-2 py-2 font-medium">Quando</th>
              <th className="px-2 py-2 font-medium">Chamada</th>
              <th className="px-2 py-2 font-medium">Registro</th>
              <th className="px-2 py-2 font-medium">Origem</th>
              <th className="px-2 py-2 font-medium">Resposta</th>
              <th className="px-2 py-2 text-right font-medium">Tempo</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  Nenhuma chamada com esses filtros.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const isOpen = open === r.id;
              return (
                <Fragment key={r.id}>
                  <tr
                    onClick={() => setOpen(isOpen ? null : r.id)}
                    className={`cursor-pointer border-t hover:bg-muted/40 ${r.kind !== "ok" ? "bg-red-50/40 dark:bg-red-950/20" : ""}`}
                  >
                    <td className="px-2 py-2 text-muted-foreground">
                      {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums text-muted-foreground">{when(r.createdAt)}</td>
                    <td className="px-2 py-2 font-mono text-xs">
                      <span className="mr-2 font-semibold">{r.method}</span>
                      {r.path}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">{r.ref ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                      {r.source ?? "—"}
                      {r.origin === "script" && <span className="ml-1 text-xs">(script)</span>}
                    </td>
                    <td className="px-2 py-2">
                      <StatusChip status={r.status} kind={r.kind} />
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-muted-foreground">
                      {r.durationMs !== null ? `${r.durationMs} ms` : "—"}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-t bg-muted/20">
                      <td />
                      <td colSpan={6} className="px-2 py-3">
                        {r.error && (
                          <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                            {r.error}
                          </p>
                        )}
                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <div className="mb-1 text-xs font-medium text-muted-foreground">Enviado (body)</div>
                            <pre className="max-h-80 overflow-auto rounded-lg border bg-background p-3 text-xs">{pretty(r.requestBody)}</pre>
                          </div>
                          <div>
                            <div className="mb-1 text-xs font-medium text-muted-foreground">Resposta do GSS</div>
                            <pre className="max-h-80 overflow-auto rounded-lg border bg-background p-3 text-xs">{pretty(r.responseBody)}</pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === limit && (
        <p className="text-xs text-muted-foreground">Mostrando as {limit} mais recentes — use os filtros para achar uma chamada mais antiga.</p>
      )}
    </div>
  );
}
