"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Package } from "lucide-react";

import type { ClientOrder, ClientOrderBucket } from "@/domain/client/portal";
import { ORDER_STATUS_LABELS } from "@/lib/status-colors";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { ProgressBar, categoriesText, formatDate, itemsText } from "../../portal-ui";

/**
 * "My orders" do portal: abas In progress / Delivered / All, busca (a do topo,
 * via `?q=`) e lista paginada. Aba e busca vivem na URL — o Dashboard linka
 * direto para uma aba, e a busca do topo de outra tela cai aqui já filtrada.
 */

type Tab = "in_progress" | "delivered" | "all";

const TABS: { id: Tab; label: string }[] = [
  { id: "in_progress", label: "In progress" },
  { id: "delivered", label: "Delivered" },
  { id: "all", label: "All" },
];

function parseTab(v: string | null): Tab {
  return v === "delivered" || v === "all" ? v : "in_progress";
}

function inTab(bucket: ClientOrderBucket, tab: Tab) {
  // Cancelado só aparece em All — não está em andamento nem foi entregue.
  return tab === "all" || bucket === tab;
}

/** Mesmo tamanho de página das listas internas (Orders, Registration…). */
const PAGE_SIZE = 10;

const TH = "px-4 text-xs font-semibold whitespace-nowrap text-slate-500";

export function OrdersClient({ orders }: { orders: ClientOrder[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = parseTab(params.get("tab"));
  const q = (params.get("q") ?? "").trim().toLowerCase();
  const [page, setPage] = useState(0);

  const searched = useMemo(() => {
    if (!q) return orders;
    return orders.filter((o) =>
      [o.po_number, o.client_reference ?? "", o.type ?? "", ...o.categories].some((v) =>
        v.toLowerCase().includes(q)
      )
    );
  }, [orders, q]);

  // Contagem por aba já com a busca aplicada — quem busca vê em que aba o
  // pedido está.
  const counts = useMemo(() => {
    const c: Record<Tab, number> = { in_progress: 0, delivered: 0, all: searched.length };
    for (const o of searched) {
      if (o.bucket === "in_progress") c.in_progress += 1;
      else if (o.bucket === "delivered") c.delivered += 1;
    }
    return c;
  }, [searched]);

  const filtered = useMemo(() => searched.filter((o) => inTab(o.bucket, tab)), [searched, tab]);

  // Muda aba/busca → volta pra 1ª página (ajuste na renderização, sem efeito).
  const filterKey = `${q}|${tab}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setPage(0);
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  function selectTab(next: Tab) {
    const sp = new URLSearchParams(params.toString());
    if (next === "in_progress") sp.delete("tab");
    else sp.set("tab", next);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Order status"
          className="inline-flex rounded-xl border bg-white p-1"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => selectTab(t.id)}
              className={cn(
                "rounded-lg px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
                tab === t.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-slate-600 hover:bg-slate-100"
              )}
            >
              {t.label} · {counts[t.id]}
            </button>
          ))}
        </div>
        {q ? (
          <p className="text-sm text-slate-500">
            Results for <span className="font-medium text-slate-700">“{params.get("q")}”</span>
          </p>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-white px-6 py-16 text-center">
          <Package className="mx-auto size-8 text-slate-300" />
          <p className="mt-3 text-sm text-slate-500">
            {orders.length === 0
              ? "You have no orders yet."
              : q
                ? "No orders match this search."
                : "No orders here."}
          </p>
        </div>
      ) : (
        <>
          {/* Cards no mobile real; tabela de 720px pra cima (mesma régua das
              listas internas — ver components/data-cards.tsx). */}
          <div className="grid gap-3 min-[720px]:hidden">
            {paged.map((o) => (
              <OrderCard key={o.id} order={o} />
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-2xl border bg-white min-[720px]:block">
            <Table className="min-w-[860px] [&_td]:py-3.5 [&_th]:py-3.5 [&_thead_tr]:bg-slate-50/80">
              <TableHeader>
                <TableRow className="hover:bg-slate-50/80">
                  <TableHead className={TH}>Order</TableHead>
                  <TableHead className={TH}>Your reference</TableHead>
                  <TableHead className={TH}>Category</TableHead>
                  <TableHead className={TH}>Items</TableHead>
                  <TableHead className={TH}>Status</TableHead>
                  <TableHead className={TH}>Progress</TableHead>
                  <TableHead className={TH}>ETA Brazil</TableHead>
                  <TableHead className="w-10 px-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((o) => (
                  <TableRow
                    key={o.id}
                    onClick={() => router.push(`/portal/${o.id}`)}
                    className="cursor-pointer transition-colors hover:bg-slate-50/60"
                  >
                    <TableCell className="px-4 font-mono text-[13px] text-slate-900">
                      {/* Link real no PO: foco por teclado sem depender do onClick da linha. */}
                      <Link
                        href={`/portal/${o.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        #{o.po_number}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate px-4 text-sm">
                      {o.client_reference ?? <span className="text-slate-400">—</span>}
                    </TableCell>
                    <TableCell
                      className="max-w-[180px] truncate px-4 text-sm text-slate-600"
                      title={o.categories.join(", ")}
                    >
                      {categoriesText(o.categories) ?? <span className="text-slate-400">—</span>}
                    </TableCell>
                    <TableCell className="px-4 text-sm whitespace-nowrap text-slate-600">
                      {o.itemCount > 0 ? (
                        itemsText(o.itemCount)
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 text-sm">
                      <StatusPill label={ORDER_STATUS_LABELS[o.status]} />
                    </TableCell>
                    <TableCell className="px-4">
                      <ProgressBar pct={o.progressPct} />
                    </TableCell>
                    <TableCell className="px-4 font-mono text-xs whitespace-nowrap text-slate-600">
                      {formatDate(o.etaBrazil) ?? <span className="text-slate-400">—</span>}
                    </TableCell>
                    <TableCell className="px-4 text-sm text-slate-300">
                      <ChevronRight className="size-4" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-slate-500">
              Page {page + 1} of {pageCount} · Total: {filtered.length}{" "}
              {filtered.length === 1 ? "record" : "records"}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="rounded-lg"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                aria-label="Previous page"
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="rounded-lg"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
                aria-label="Next page"
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Pedido em card — usado abaixo de 720px (aqui e no Dashboard). */
export function OrderCard({ order: o }: { order: ClientOrder }) {
  const eta = formatDate(o.etaBrazil);
  const category = categoriesText(o.categories);
  return (
    <Link
      href={`/portal/${o.id}`}
      className="block rounded-xl border bg-white p-4 shadow-sm transition-colors hover:border-violet-300 hover:bg-slate-50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[15px] text-slate-900">#{o.po_number}</p>
          {o.client_reference ? (
            <p className="mt-0.5 truncate text-xs text-slate-500">{o.client_reference}</p>
          ) : null}
        </div>
        <StatusPill label={ORDER_STATUS_LABELS[o.status]} />
      </div>
      {category || o.itemCount > 0 ? (
        <p className="mt-3 text-sm text-slate-600">
          {[category, o.itemCount > 0 ? itemsText(o.itemCount) : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-3">
        <ProgressBar pct={o.progressPct} />
        <p className="text-xs text-slate-500">
          ETA Brazil <span className="font-mono text-slate-700">{eta ?? "—"}</span>
        </p>
      </div>
    </Link>
  );
}
