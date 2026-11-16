"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, CalendarClock, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDateNumeric } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";
import {
  getEtdNotifications,
  markEtdNotificationsRead,
  markEtdPopupSeen,
} from "@/lib/etd-notifications-actions";
import type { EtdNotification } from "@/lib/etd-notifications";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const POLL_MS = 5 * 60_000;

function overdueText(days: number): string {
  if (days === 0) return "Initial Date is today";
  return `${days} day${days === 1 ? "" : "s"} past the Initial Date`;
}

/**
 * Estado das notificações — UMA consulta por shell (o sino aparece em mais de
 * um lugar: rodapé da sidebar completa, trilho estreito e top bar do celular;
 * o popup diário usa o mesmo estado).
 */
export function useEtdNotifications() {
  const [items, setItems] = useState<EtdNotification[] | null>(null);
  const [allOrders, setAllOrders] = useState(false);
  const [popupDue, setPopupDue] = useState(false);
  const [, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    try {
      const payload = await getEtdNotifications();
      setItems(payload.items);
      setAllOrders(payload.allOrders);
      setPopupDue(payload.popupDue);
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

  /** Popup diário mostrado: grava o dia para não abrir de novo hoje (nem em outra aba). */
  const popupShown = useCallback(() => {
    setPopupDue(false);
    startTransition(async () => {
      await markEtdPopupSeen();
    });
  }, []);

  return { items, allOrders, popupDue, refresh, markRead, popupShown };
}

export type EtdNotificationsState = ReturnType<typeof useEtdNotifications>;

function footerText(allOrders: boolean): string {
  return allOrders
    ? "As an admin you see every overdue ETD line, until its ready parts are set."
    : "You get these as the ETD Responsible, until the line's ready parts are set.";
}

/** Lista das notificações — a mesma no sino e no popup diário. */
function NotificationList({
  items,
  allOrders,
  onOpen,
}: {
  items: EtdNotification[];
  allOrders: boolean;
  onOpen: (n: EtdNotification) => void;
}) {
  return (
    <ul className="divide-y">
      {items.map((n) => (
        <li key={n.key}>
          <button
            type="button"
            onClick={() => onOpen(n)}
            className={cn(
              "flex w-full gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-slate-50",
              !n.read && "bg-primary/5"
            )}
          >
            <CalendarClock
              className={cn("mt-0.5 size-4 shrink-0", n.daysOverdue > 0 ? "text-red-600" : "text-amber-600")}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="font-medium text-slate-900">ETD due · Order {n.poNumber}</span>
                {!n.read && <span className="size-2 shrink-0 rounded-full bg-primary" />}
              </span>
              <span className="mt-0.5 block text-xs text-slate-600">
                {n.client ? `${n.client} · ` : ""}
                {n.lines} line{n.lines === 1 ? "" : "s"} without ready parts · {overdueText(n.daysOverdue)} (
                {formatDateNumeric(n.earliestInitialDate)})
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {n.factories.join(", ")}
                {allOrders ? ` · Responsible: ${n.responsible ?? "none"}` : ""}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Sino de notificações (09/11/2026; 10/11 saiu do topo e foi pro rodapé da
 * sidebar, ao lado do usuário) — hoje só "ETD vencendo": a Initial Date de uma
 * linha da ETD Factories passou e as peças não estão prontas. User comum vê as
 * Orders em que é o Responsible da ETD; admin/owner vê todas (16/11/2026). O
 * número = não lidas. Clicar numa notificação marca como lida e abre a ETD
 * Factories filtrada na Order.
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
  const { items, allOrders, refresh, markRead } = state;
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
              {/* Acima de 9 vira "+9" (16/11/2026, pedido do usuário); o número
                  exato fica no aria-label e na lista. */}
              {unread.length > 9 ? "+9" : unread.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side={side} align={align} sideOffset={12} className="w-[min(380px,calc(100vw-32px))] p-0">
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
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">No notifications.</p>
          ) : (
            <NotificationList items={items} allOrders={allOrders} onOpen={openItem} />
          )}
        </div>
        <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">{footerText(allOrders)}</p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Popup diário (16/11/2026, pedido do usuário: "pelo menos uma vez por dia
 * notificar com um popup na cara"): na primeira vez do dia em que o usuário
 * tem ETD atrasada, abre sozinho com a lista. Ao abrir, o dia já fica gravado
 * (`ui_preferences.etd_popup_day`) — fechar, clicar numa Order ou recarregar
 * não traz de volta; amanhã, com pendência, abre de novo. O sino segue igual.
 */
export function EtdDailyPopup({ state }: { state: EtdNotificationsState }) {
  const router = useRouter();
  const { items, allOrders, popupDue, popupShown, markRead } = state;
  const [open, setOpen] = useState(false);
  const pending = items ?? [];

  useEffect(() => {
    if (!popupDue || pending.length === 0) return;
    // Fora do corpo do effect: abre e grava o dia sem cascata de render.
    const t = window.setTimeout(() => {
      setOpen(true);
      popupShown();
    }, 0);
    return () => window.clearTimeout(t);
  }, [popupDue, pending.length, popupShown]);

  const unread = pending.filter((n) => !n.read);
  const lines = pending.reduce((sum, n) => sum + n.lines, 0);

  const openItem = (n: EtdNotification) => {
    markRead([n.key]);
    setOpen(false);
    router.push(n.href);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="border-b px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-5 text-red-600" />
            Overdue ETDs
          </DialogTitle>
          <DialogDescription>
            {pending.length} order{pending.length === 1 ? "" : "s"} · {lines} line{lines === 1 ? "" : "s"} past the
            Initial Date without ready parts
            {allOrders ? " (all orders, as an admin)." : " (orders where you are the ETD Responsible)."}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NotificationList items={pending} allOrders={allOrders} onOpen={openItem} />
        </div>
        <DialogFooter className="border-t px-5 py-3">
          {unread.length > 0 && (
            <Button
              variant="outline"
              onClick={() => {
                markRead(unread.map((n) => n.key));
                setOpen(false);
              }}
            >
              Mark all as read
            </Button>
          )}
          <Button onClick={() => setOpen(false)}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
