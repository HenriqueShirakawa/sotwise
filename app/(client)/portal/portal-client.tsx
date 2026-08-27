"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Package, Search } from "lucide-react";

import type { ClientOrder } from "@/domain/client/portal";
import { ORDER_STATUS_LABELS } from "@/lib/status-colors";
import { StatusPill } from "@/components/status-pill";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OrderStatus } from "@/types/database";

/** "2 In Transit · 1 In Production" — estágio dos itens. */
function progressText(progress: ClientOrder["progress"]) {
  return progress.map((p) => `${p.count} ${p.label}`).join(" · ");
}

function batchCountText(count: number) {
  return `${count} ${count === 1 ? "batch" : "batches"}`;
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

export function PortalClient({ orders }: { orders: ClientOrder[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | OrderStatus>("all");

  // Só os status que este cliente realmente tem — um filtro cheio de opções que
  // não devolvem nada é ruído para quem tem 3 pedidos.
  const statuses = useMemo(
    () => [...new Set(orders.map((o) => o.status))].sort(),
    [orders]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (status !== "all" && o.status !== status) return false;
      if (!q) return true;
      return [o.po_number, o.client_reference ?? "", o.type ?? "", ...o.batchNumbers].some(
        (v) => v.toLowerCase().includes(q)
      );
    });
  }, [orders, search, status]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">My orders</h1>
        <p className="mt-1 text-sm text-slate-500">
          Follow the progress of your orders with AGK.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1 sm:max-w-[380px]">
          <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Order number or your reference"
            className="!h-11 rounded-xl bg-white pl-10"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as "all" | OrderStatus)}>
          <SelectTrigger className="!h-11 w-full rounded-xl bg-white sm:w-56">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-white px-6 py-16 text-center">
          <Package className="mx-auto size-8 text-slate-300" />
          <p className="mt-3 text-sm text-slate-500">
            {orders.length === 0
              ? "You have no orders in progress yet."
              : "No orders match this search."}
          </p>
        </div>
      ) : (
        <>
          {/* Cards no mobile real; tabela de 720px pra cima (mesma régua das
              listas internas — ver components/data-cards.tsx). */}
          <div className="grid gap-3 min-[720px]:hidden">
            {filtered.map((o) => {
              const scheduleReq = formatDate(o.scheduleRequested);
              return (
                <Link
                  key={o.id}
                  href={`/portal/${o.id}`}
                  className="block rounded-xl border bg-white p-4 shadow-sm transition-colors hover:border-violet-300 hover:bg-slate-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-[15px] text-slate-900">#{o.po_number}</p>
                      {o.type ? <p className="mt-0.5 text-xs text-slate-500">{o.type}</p> : null}
                    </div>
                    <StatusPill label={ORDER_STATUS_LABELS[o.status]} />
                  </div>
                  {o.client_reference ? (
                    <p className="mt-3 text-sm text-slate-600">
                      <span className="text-slate-400">Your reference: </span>
                      {o.client_reference}
                    </p>
                  ) : null}
                  {o.batchNumbers.length > 0 ? (
                    <p className="mt-1 text-sm text-slate-600">
                      <span className="text-slate-400">Batch No.: </span>
                      <span className="font-mono text-accent-foreground">
                        {batchCountText(o.batchNumbers.length)}
                      </span>
                    </p>
                  ) : null}
                  {o.progress.length > 0 ? (
                    <p className="mt-1 text-sm text-slate-500">{progressText(o.progress)}</p>
                  ) : null}
                  {scheduleReq ? (
                    <p className="mt-1 text-xs text-slate-400">
                      Schedule req. <span className="font-mono">{scheduleReq}</span>
                    </p>
                  ) : null}
                </Link>
              );
            })}
          </div>

          <div className="hidden overflow-x-auto rounded-2xl border bg-white min-[720px]:block">
            <Table className="min-w-[820px] [&_td]:py-3.5 [&_th]:py-3.5 [&_thead_tr]:bg-slate-50/80">
              <TableHeader>
                <TableRow className="hover:bg-slate-50/80">
                  <TableHead className="px-4 text-xs font-semibold whitespace-nowrap text-slate-500">
                    Order
                  </TableHead>
                  <TableHead className="px-4 text-xs font-semibold whitespace-nowrap text-slate-500">
                    Your reference
                  </TableHead>
                  <TableHead className="px-4 text-xs font-semibold whitespace-nowrap text-slate-500">
                    Batch No.
                  </TableHead>
                  <TableHead className="px-4 text-xs font-semibold whitespace-nowrap text-slate-500">
                    Progress
                  </TableHead>
                  <TableHead className="px-4 text-xs font-semibold whitespace-nowrap text-slate-500">
                    Schedule req.
                  </TableHead>
                  <TableHead className="px-4 text-xs font-semibold whitespace-nowrap text-slate-500">
                    Status
                  </TableHead>
                  <TableHead className="w-10 px-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((o) => (
                  <TableRow
                    key={o.id}
                    onClick={() => router.push(`/portal/${o.id}`)}
                    className="cursor-pointer transition-colors hover:bg-slate-50/60"
                  >
                    <TableCell className="px-4 text-sm font-mono text-[13px] text-slate-900">
                      {/* Link real no PO: dá foco por teclado e navegação sem
                          depender do onClick da linha (que é só conveniência). */}
                      <Link
                        href={`/portal/${o.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        #{o.po_number}
                      </Link>
                    </TableCell>
                    <TableCell className="px-4 text-sm">
                      {o.client_reference ?? <span className="text-slate-400">—</span>}
                    </TableCell>
                    <TableCell className="px-4 text-sm font-mono text-xs text-accent-foreground">
                      {o.batchNumbers.length > 0 ? (
                        batchCountText(o.batchNumbers.length)
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 text-sm text-slate-500">
                      {o.progress.length > 0 ? (
                        progressText(o.progress)
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 text-sm font-mono text-xs text-slate-500">
                      {formatDate(o.scheduleRequested) ?? (
                        <span className="text-slate-400">—</span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 text-sm">
                      <StatusPill label={ORDER_STATUS_LABELS[o.status]} />
                    </TableCell>
                    <TableCell className="px-4 text-sm text-slate-300">
                      <ChevronRight className="size-4" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Contagem real — a lista não é paginada (o cliente tem poucos
              pedidos), então nada de controles de página falsos aqui. */}
          <p className="text-sm text-slate-500">
            {filtered.length} {filtered.length === 1 ? "record" : "records"}
          </p>
        </>
      )}
    </div>
  );
}
