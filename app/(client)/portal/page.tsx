import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarDays, ChevronRight, CircleCheck, Package } from "lucide-react";

import { buildClientDashboard, loadClientOrders } from "@/domain/client/portal";
import { requireClientScope } from "@/lib/dal";
import { ORDER_STATUS_LABELS } from "@/lib/status-colors";
import { StatusPill } from "@/components/status-pill";

import { ProgressBar, formatDate } from "../portal-ui";
import { OrderCard } from "./orders/orders-client";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Dashboard do portal: pedidos ativos, próxima entrega, pedidos com ETA ao
 * Brasil vencida e os mais recentes em andamento. Tudo sai da mesma leitura de
 * "My orders" (`buildClientDashboard`) — sem fornecedor nem valor, que dependem
 * de decisão (bloco G do card).
 */
export default async function PortalDashboardPage() {
  // Guarda repetida (não só no layout) — ver o comentário em layout.tsx.
  const { session, clientId } = await requireClientScope();
  const orders = await loadClientOrders(clientId);
  const d = buildClientDashboard(orders);
  const firstName = session.profile.full_name.split(" ").filter(Boolean)[0] ?? "";

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
          Hi{firstName ? `, ${firstName}` : ""}
        </h2>
        <p className="mt-1 text-sm text-slate-500">Here&apos;s a summary of your orders with AGK.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/portal/orders"
          className="rounded-2xl border bg-white p-5 transition-colors hover:border-violet-300"
        >
          <div className="flex items-center gap-2.5 text-sm text-slate-500">
            <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-primary">
              <Package className="size-4" />
            </span>
            Active orders
          </div>
          <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">{d.active}</p>
          <p className="mt-1 text-xs text-slate-500">
            of {d.total} total · {d.delivered} delivered
          </p>
        </Link>

        {d.nextDelivery ? (
          <Link
            href={`/portal/${d.nextDelivery.id}`}
            className="rounded-2xl border bg-white p-5 transition-colors hover:border-violet-300"
          >
            <NextDeliveryHeader />
            <p className="mt-4 font-mono text-3xl font-semibold tracking-tight text-slate-900">
              {formatDate(d.nextDelivery.etaBrazil)}
            </p>
            <p className="mt-1 truncate text-xs text-slate-500">
              <span className="font-mono">#{d.nextDelivery.po_number}</span>
              {d.nextDelivery.client_reference ? ` · ${d.nextDelivery.client_reference}` : ""}
            </p>
          </Link>
        ) : (
          <div className="rounded-2xl border bg-white p-5">
            <NextDeliveryHeader />
            <p className="mt-4 text-lg font-medium text-slate-400">To be confirmed</p>
            <p className="mt-1 text-xs text-slate-500">No upcoming ETA for your active orders.</p>
          </div>
        )}
      </div>

      <section className="rounded-2xl border bg-white p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <AlertTriangle className="size-4 text-red-500" />
          Orders that need attention
        </h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Orders past their expected arrival date in Brazil.
        </p>
        {d.attention.length === 0 ? (
          <p className="mt-4 flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <CircleCheck className="size-4 text-emerald-600" />
            All your orders are on schedule.
          </p>
        ) : (
          <div className="mt-4 grid gap-2">
            {d.attention.map((o) => (
              <Link
                key={o.id}
                href={`/portal/${o.id}`}
                className="flex items-center gap-3 rounded-xl border border-red-100 bg-red-50/60 px-4 py-3 transition-colors hover:bg-red-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-slate-900">#{o.po_number}</span>
                    <StatusPill label={ORDER_STATUS_LABELS[o.status]} />
                  </div>
                  {o.client_reference ? (
                    <p className="mt-0.5 truncate text-xs text-slate-500">{o.client_reference}</p>
                  ) : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-red-600">
                    {o.daysLate} {o.daysLate === 1 ? "day" : "days"} late
                  </p>
                  <p className="text-xs text-slate-500">
                    Expected <span className="font-mono">{formatDate(o.etaBrazil)}</span>
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-slate-300" />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border bg-white">
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
          <h3 className="text-sm font-semibold text-slate-900">Recent orders in progress</h3>
          <Link
            href="/portal/orders"
            className="text-sm font-medium text-primary hover:underline"
          >
            View all →
          </Link>
        </div>

        {d.recent.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-slate-500">You have no orders in progress.</p>
        ) : (
          <>
            <div className="grid gap-3 px-5 pb-5 min-[720px]:hidden">
              {d.recent.map((o) => (
                <OrderCard key={o.id} order={o} />
              ))}
            </div>
            <div className="hidden overflow-x-auto min-[720px]:block">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-y bg-slate-50/80 text-left text-xs font-semibold text-slate-500">
                    <th className="px-5 py-3">Order</th>
                    <th className="px-5 py-3">Your reference</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Progress</th>
                    <th className="px-5 py-3 text-right">ETA Brazil</th>
                  </tr>
                </thead>
                <tbody>
                  {d.recent.map((o) => (
                    <tr key={o.id} className="border-b last:border-b-0 hover:bg-slate-50/60">
                      <td className="px-5 py-3 font-mono text-[13px] text-slate-900">
                        <Link href={`/portal/${o.id}`} className="hover:underline">
                          #{o.po_number}
                        </Link>
                      </td>
                      <td className="max-w-[220px] truncate px-5 py-3 text-slate-600">
                        {o.client_reference ?? <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-5 py-3">
                        <StatusPill label={ORDER_STATUS_LABELS[o.status]} />
                      </td>
                      <td className="px-5 py-3">
                        <ProgressBar pct={o.progressPct} />
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-xs text-slate-600">
                        {formatDate(o.etaBrazil) ?? <span className="text-slate-400">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function NextDeliveryHeader() {
  return (
    <div className="flex items-center gap-2.5 text-sm text-slate-500">
      <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-primary">
        <CalendarDays className="size-4" />
      </span>
      Next delivery
    </div>
  );
}
