"use client";

import { ORDER_STATUS_LABELS, BATCH_STATUS_LABELS } from "@/lib/status-colors";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/components/status-pill";
import type { BatchStatus, OrderStatus } from "@/types/database";

import { usePortalI18n } from "./portal-i18n-provider";

/**
 * Peças de apresentação compartilhadas pelas telas do portal (Dashboard, My
 * orders, detalhe). Sem dado próprio — o recorte do que o cliente vê é
 * decidido em domain/client/portal.ts; o idioma vem do `PortalI18nProvider`.
 */

/** Status do pedido traduzido, com a cor do status (que segue o rótulo em inglês). */
export function OrderStatusPill({ status }: { status: OrderStatus }) {
  const { t } = usePortalI18n();
  return <StatusPill label={ORDER_STATUS_LABELS[status]} text={t.orderStatus[status]} />;
}

export function BatchStatusPill({ status }: { status: BatchStatus }) {
  const { t } = usePortalI18n();
  return <StatusPill label={BATCH_STATUS_LABELS[status]} text={t.batchStatus[status]} />;
}

/** Barra fina + "%" — progresso do pedido pelos lotes (ver `progressPct`). */
export function ProgressBar({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-slate-200"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 text-xs text-slate-500 tabular-nums">{pct}%</span>
    </div>
  );
}
