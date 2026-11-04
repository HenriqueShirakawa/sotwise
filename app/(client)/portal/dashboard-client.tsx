"use client";

import Link from "next/link";
import { AlertTriangle, CalendarDays, ChevronRight, CircleCheck, Package } from "lucide-react";

import type { ClientDashboard } from "@/domain/client/portal";

import { formatDate } from "../portal-format";
import { usePortalI18n } from "../portal-i18n-provider";
import { OrderStatusPill, ProgressBar } from "../portal-ui";
import { OrderCard } from "./orders/orders-client";

export function DashboardClient({
  dashboard: d,
  firstName,
}: {
  dashboard: ClientDashboard;
  firstName: string;
}) {
  const { t } = usePortalI18n();
  const td = t.dashboard;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{td.hi(firstName)}</h2>
        <p className="mt-1 text-sm text-slate-500">{td.summary}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/portal/orders"
          className="rounded-2xl border bg-white p-5 transition-colors hover:border-violet-300"
        >
          <CardHeader icon={Package} title={td.activeOrders} />
          <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">{d.active}</p>
          <p className="mt-1 text-xs text-slate-500">{td.ofTotal(d.total, d.delivered)}</p>
        </Link>

        {d.nextDelivery ? (
          <Link
            href={`/portal/${d.nextDelivery.id}`}
            className="rounded-2xl border bg-white p-5 transition-colors hover:border-violet-300"
          >
            <CardHeader icon={CalendarDays} title={td.nextDelivery} />
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
            <CardHeader icon={CalendarDays} title={td.nextDelivery} />
            <p className="mt-4 text-lg font-medium text-slate-400">{t.common.toBeConfirmed}</p>
            <p className="mt-1 text-xs text-slate-500">{td.noUpcomingEta}</p>
          </div>
        )}
      </div>

      <section className="rounded-2xl border bg-white p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <AlertTriangle className="size-4 text-red-500" />
          {td.attentionTitle}
        </h3>
        <p className="mt-0.5 text-xs text-slate-500">{td.attentionSubtitle}</p>
        {d.attention.length === 0 ? (
          <p className="mt-4 flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <CircleCheck className="size-4 text-emerald-600" />
            {td.allOnSchedule}
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
                    <OrderStatusPill status={o.status} />
                  </div>
                  {o.client_reference ? (
                    <p className="mt-0.5 truncate text-xs text-slate-500">{o.client_reference}</p>
                  ) : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-red-600">{td.daysLate(o.daysLate)}</p>
                  <p className="text-xs text-slate-500">
                    {t.common.expected} <span className="font-mono">{formatDate(o.etaBrazil)}</span>
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
          <h3 className="text-sm font-semibold text-slate-900">{td.recentTitle}</h3>
          <Link href="/portal/orders" className="text-sm font-medium text-primary hover:underline">
            {td.viewAll}
          </Link>
        </div>

        {d.recent.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-slate-500">{td.noInProgress}</p>
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
                    <th className="px-5 py-3">{t.orders.colOrder}</th>
                    <th className="px-5 py-3">{t.orders.colReference}</th>
                    <th className="px-5 py-3">{t.orders.colStatus}</th>
                    <th className="px-5 py-3">{t.orders.colProgress}</th>
                    <th className="px-5 py-3 text-right">{t.orders.colEta}</th>
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
                        <OrderStatusPill status={o.status} />
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

function CardHeader({ icon: Icon, title }: { icon: typeof Package; title: string }) {
  return (
    <div className="flex items-center gap-2.5 text-sm text-slate-500">
      <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-primary">
        <Icon className="size-4" />
      </span>
      {title}
    </div>
  );
}
