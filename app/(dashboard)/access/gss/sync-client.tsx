"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, Lock, RefreshCw, Search, TriangleAlert } from "lucide-react";

export type SyncTab = "orders" | "batches";

export type SyncRow = {
  id: number;
  createdAt: string;
  action: "created" | "updated" | "linked" | "warning" | "error";
  gssId: string;
  ref: string | null;
  orderId: string | null;
  changes: { field: string; before: string | null; after: string | null }[];
  message: string | null;
  origin: string;
};

const ACTIONS: Record<SyncRow["action"], { label: string; cls: string }> = {
  created: {
    label: "Criado",
    cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  },
  updated: {
    label: "Atualizado",
    cls: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
  },
  linked: {
    label: "Vinculado",
    cls: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900",
  },
  warning: {
    label: "Aviso",
    cls: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  },
  error: {
    label: "Erro",
    cls: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
  },
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Counter({ value, label, alert }: { value: number | string; label: string; alert?: boolean }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className={`text-2xl font-semibold tabular-nums ${alert ? "text-red-600" : ""}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function SyncClient({
  tab,
  rows,
  limit,
  changes24,
  problems24,
  lastRun,
  locked,
  filters,
  loadError,
}: {
  tab: SyncTab;
  rows: SyncRow[];
  limit: number;
  changes24: number;
  problems24: number;
  lastRun: { at: string; ok: boolean; error: string | null } | null;
  locked: boolean;
  filters: { onlyProblems: boolean; search: string };
  loadError: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(filters.search);

  // A aba (`v`) vem do GSS parity; aqui só os filtros dela.
  function go(next: Partial<{ onlyProblems: boolean; search: string }>) {
    const f = { ...filters, ...next };
    const params = new URLSearchParams({ v: tab });
    if (f.onlyProblems) params.set("f", "problemas");
    if (f.search) params.set("q", f.search);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      {locked && (
        <div className="flex items-start gap-2 rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <span>
            Travado: o cron só lê Orders e Lotes do GSS e não grava nada, enquanto o GSS é alimentado. Para
            destravar, crie <code className="font-mono text-xs">GSS_ORDERS_PULL_ENABLED=true</code> na Vercel
            (Production) e faça redeploy.
          </span>
        </div>
      )}

      {loadError && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {loadError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:max-w-2xl sm:grid-cols-3">
        <Counter
          value={lastRun ? when(lastRun.at) : "—"}
          label={lastRun ? (lastRun.ok ? "última execução do cron" : "última execução falhou") : "o cron ainda não rodou"}
          alert={lastRun ? !lastRun.ok : false}
        />
        <Counter value={changes24} label="registros mexidos nas últimas 24 h" />
        <Counter value={problems24} label="avisos e erros nas últimas 24 h" alert={problems24 > 0} />
      </div>
      {lastRun && !lastRun.ok && lastRun.error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {lastRun.error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border p-0.5 text-sm">
          <button
            type="button"
            onClick={() => go({ onlyProblems: false })}
            className={`rounded-md px-3 py-1 ${!filters.onlyProblems ? "bg-muted font-medium" : "text-muted-foreground"}`}
          >
            Tudo
          </button>
          <button
            type="button"
            onClick={() => go({ onlyProblems: true })}
            className={`rounded-md px-3 py-1 ${filters.onlyProblems ? "bg-muted font-medium" : "text-muted-foreground"}`}
          >
            Avisos e erros
          </button>
        </div>

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
            placeholder={tab === "orders" ? "PO 1705 ou id do GSS" : "1705.01 ou id do GSS"}
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
              <th className="px-3 py-2 font-medium">Quando</th>
              <th className="px-3 py-2 font-medium">{tab === "orders" ? "Order" : "Lote"}</th>
              <th className="px-3 py-2 font-medium">GSS id</th>
              <th className="px-3 py-2 font-medium">Ação</th>
              <th className="px-3 py-2 font-medium">O que mudou</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  {filters.onlyProblems || filters.search
                    ? "Nada com esses filtros."
                    : "O cron ainda não mexeu em nenhum registro aqui."}
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const a = ACTIONS[r.action];
              return (
                <tr key={r.id} className="border-t align-top">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                    {when(r.createdAt)}
                    {r.origin === "script" && <span className="ml-1 text-xs">(script)</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium">
                    {r.orderId ? (
                      <Link href={`/orders/${r.orderId}`} className="hover:underline">
                        {r.ref ?? "—"}
                      </Link>
                    ) : (
                      (r.ref ?? "—")
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted-foreground">{r.gssId}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-xs ${a.cls}`}>{a.label}</span>
                  </td>
                  <td className="px-3 py-2">
                    {r.changes.length > 0 && (
                      <ul className="space-y-0.5">
                        {r.changes.map((c, i) => (
                          <li key={i} className="flex flex-wrap items-center gap-1.5">
                            <span className="text-muted-foreground">{c.field}:</span>
                            {c.before !== null && (
                              <>
                                <span className="line-through decoration-muted-foreground/60">{c.before}</span>
                                <ArrowRight className="size-3 text-muted-foreground" />
                              </>
                            )}
                            <span>{c.after ?? "—"}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {r.message && (
                      <p className={`text-xs ${r.action === "error" ? "text-red-700 dark:text-red-300" : "text-amber-800 dark:text-amber-300"} ${r.changes.length ? "mt-1" : ""}`}>
                        {r.message}
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === limit && (
        <p className="text-xs text-muted-foreground">Mostrando os {limit} mais recentes — use a busca para achar um registro mais antigo.</p>
      )}
    </div>
  );
}
