"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, CalendarClock, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDateNumeric } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";
import { getEtdNotifications, markEtdNotificationsRead } from "@/lib/etd-notifications-actions";
import type { EtdNotification } from "@/lib/etd-notifications";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const POLL_MS = 5 * 60_000;

function overdueText(days: number): string {
  if (days === 0) return "Initial Date is today";
  return `${days} day${days === 1 ? "" : "s"} past the Initial Date`;
}

/**
 * Sino de notificações (09/11/2026) — hoje só "ETD vencendo": a Initial Date
 * de uma linha da ETD Factories chegou e a etapa ETD (da qual o usuário é o
 * Responsible) segue aberta. O número = não lidas. Clicar numa notificação
 * marca como lida e abre a ETD Factories filtrada na Order.
 */
export function NotificationBell({
  className,
  media,
}: {
  className?: string;
  /** O shell tem um sino no celular e outro a partir de 768px (um fica
   *  escondido por CSS); só o visível consulta o servidor. */
  media: "mobile" | "desktop";
}) {
  const router = useRouter();
  const [items, setItems] = useState<EtdNotification[] | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => setActive(media === "desktop" ? mq.matches : !mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [media]);

  const refresh = useCallback(async () => {
    try {
      setItems(await getEtdNotifications());
    } catch {
      // Falha de rede/sessão: mantém o que já estava na tela.
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    // Fora do corpo do effect (timer): a 1ª leitura sem cascata de render.
    const t = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(t);
  }, [active, refresh]);
  usePoll(refresh, { enabled: active, intervalMs: POLL_MS });

  const unread = (items ?? []).filter((n) => !n.read);

  const markRead = (keys: string[]) => {
    if (keys.length === 0) return;
    setItems((prev) => prev?.map((n) => (keys.includes(n.key) ? { ...n, read: true } : n)) ?? prev);
    startTransition(async () => {
      await markEtdNotificationsRead(keys);
    });
  };

  const openItem = (n: EtdNotification) => {
    markRead([n.key]);
    setOpen(false);
    router.push(n.href);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) void refresh();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unread.length ? `Notifications (${unread.length} unread)` : "Notifications"}
          title="Notifications"
          className={cn(
            "relative flex size-10 items-center justify-center rounded-full border bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900",
            className
          )}
        >
          <Bell className="size-[18px]" />
          {unread.length > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-semibold leading-none text-white">
              {unread.length > 99 ? "99+" : unread.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(380px,calc(100vw-32px))] p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          {unread.length > 0 && (
            <button
              type="button"
              className="text-xs font-medium text-primary hover:underline"
              onClick={() => markRead(unread.map((n) => n.key))}
            >
              Mark all as read
            </button>
          )}
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {items === null ? (
            <div className="flex justify-center py-8 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No notifications.
            </p>
          ) : (
            <ul className="divide-y">
              {items.map((n) => (
                <li key={n.key}>
                  <button
                    type="button"
                    onClick={() => openItem(n)}
                    className={cn(
                      "flex w-full gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-slate-50",
                      !n.read && "bg-primary/5"
                    )}
                  >
                    <CalendarClock
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        n.daysOverdue > 0 ? "text-red-600" : "text-amber-600"
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="font-medium text-slate-900">
                          ETD due · Order {n.poNumber}
                        </span>
                        {!n.read && <span className="size-2 shrink-0 rounded-full bg-primary" />}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-600">
                        {n.client ? `${n.client} · ` : ""}
                        {n.lines} line{n.lines === 1 ? "" : "s"} without ready parts ·{" "}
                        {overdueText(n.daysOverdue)} ({formatDateNumeric(n.earliestInitialDate)})
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {n.factories.join(", ")}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
          You get these as the ETD Responsible, from the Initial Date until the ETD step is done.
        </p>
      </PopoverContent>
    </Popover>
  );
}
