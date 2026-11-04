"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { toast } from "sonner";

import type { PortalNotification } from "@/domain/client/portal-notifications";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { markAllPortalNotificationsRead, markPortalNotificationRead } from "./notification-actions";
import { usePortalI18n } from "./portal-i18n-provider";
import { BatchStatusPill } from "./portal-ui";

/** "há 3 horas" / "3 hours ago" / "3 小时前" — no idioma do portal. */
function relativeTime(iso: string, locale: string): string {
  const diffSec = (Date.parse(iso) - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(Math.round(diffSec), "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), "day");
  return rtf.format(Math.round(diffSec / (86400 * 30)), "month");
}

/**
 * Sino do portal: últimos avanços de lote do cliente (outbox da 2.1). Clicar
 * num aviso marca como lido e abre o pedido; "marcar todas" zera o contador.
 * O estado local é otimista — a tela não espera o servidor para apagar a bolinha.
 */
export function NotificationBell({ notifications }: { notifications: PortalNotification[] }) {
  const { t, locale } = usePortalI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(notifications);
  const [, startTransition] = useTransition();

  // Lista nova do servidor (refresh/navegação) substitui a local.
  const [prev, setPrev] = useState(notifications);
  if (prev !== notifications) {
    setPrev(notifications);
    setItems(notifications);
  }

  const unread = items.filter((n) => n.unread).length;

  function openItem(n: PortalNotification) {
    setOpen(false);
    if (n.unread) {
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, unread: false } : x)));
      startTransition(async () => {
        const res = await markPortalNotificationRead(n.id);
        if (!res.ok) toast.error(res.error);
      });
    }
    router.push(`/portal/${n.orderId}`);
  }

  function markAll() {
    setItems((list) => list.map((x) => ({ ...x, unread: false })));
    startTransition(async () => {
      const res = await markAllPortalNotificationsRead();
      if (!res.ok) toast.error(res.error);
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t.bell.open(unread)}
          title={t.bell.title}
          className="relative shrink-0 text-slate-600"
        >
          <Bell className="size-[18px]" />
          {unread > 0 ? (
            <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] leading-none font-semibold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(380px,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <p className="text-sm font-semibold text-slate-900">{t.bell.title}</p>
          {unread > 0 ? (
            <button
              type="button"
              onClick={markAll}
              className="text-xs font-medium text-primary hover:underline"
            >
              {t.bell.markAllRead}
            </button>
          ) : null}
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">{t.bell.empty}</p>
        ) : (
          <ul className="max-h-[420px] overflow-y-auto">
            {items.map((n) => (
              <li key={n.id} className="border-b last:border-0">
                <button
                  type="button"
                  onClick={() => openItem(n)}
                  className={cn(
                    "flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50",
                    n.unread && "bg-accent/40"
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      n.unread ? "bg-primary" : "bg-transparent"
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-sm",
                        n.unread ? "font-semibold text-slate-900" : "text-slate-700"
                      )}
                    >
                      {t.bell.item(n.poNumber, n.batchCode)}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      {t.bell.movedTo}
                      <BatchStatusPill status={n.toStatus} />
                    </span>
                    <span className="mt-1 block text-[11px] text-slate-400">
                      {relativeTime(n.createdAt, locale)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
