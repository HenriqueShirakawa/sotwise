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
 * Estado das notificações — UMA consulta por shell (o sino aparece em mais de
 * um lugar: rodapé da sidebar completa, trilho estreito e top bar do celular).
 */
export function useEtdNotifications() {
  const [items, setItems] = useState<EtdNotification[] | null>(null);
  const [, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    try {
      setItems(await getEtdNotifications());
    } catch {
      // Falha de rede/sessão: mantém o que já estava na tela.
    }
  }, []);

  useEffect(() => {
    // Fora do corpo do effect (timer): a 1ª leitura sem cascata de render.
    const t = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(t);
  }, [refresh]);
  usePoll(refresh, { enabled: true, intervalMs: POLL_MS });

  const markRead = useCallback((keys: string[]) => {
    if (keys.length === 0) return;
    setItems((prev) => prev?.map((n) => (keys.includes(n.key) ? { ...n, read: true } : n)) ?? prev);
    startTransition(async () => {
      await markEtdNotificationsRead(keys);
    });
  }, []);

  return { items, refresh, markRead };
}

export type EtdNotificationsState = ReturnType<typeof useEtdNotifications>;

/**
 * Sino de notificações (09/11/2026; 10/11 saiu do topo e foi pro rodapé da
 * sidebar, ao lado do usuário) — hoje só "ETD vencendo": a Initial Date de uma
 * linha da ETD Factories chegou e a etapa ETD (da qual o usuário é o
 * Responsible) segue aberta. O número = não lidas. Clicar numa notificação
 * marca como lida e abre a ETD Factories filtrada na Order.
 */
export function NotificationBell({
  state,
  open,
  onOpenChange,
  className,
  side = "bottom",
  align = "end",
}: {
  state: EtdNotificationsState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}) {
  const router = useRouter();
  const { items, refresh, markRead } = state;
  const unread = (items ?? []).filter((n) => !n.read);

  const openItem = (n: EtdNotification) => {
    markRead([n.key]);
    onOpenChange(false);
    router.push(n.href);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (v) void refresh();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unread.length ? `Notifications (${unread.length} unread)` : "Notifications"}
          title="Notifications"
          className={cn(
            "relative flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900",
            open && "bg-slate-100 text-slate-900",
            className
          )}
        >
          <Bell className="size-[18px]" />
          {unread.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
              {unread.length > 99 ? "99+" : unread.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={12}
        className="w-[min(380px,calc(100vw-32px))] p-0"
      >
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
