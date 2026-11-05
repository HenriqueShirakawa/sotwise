"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Clock,
  FileText,
  MapPin,
  MessageSquare,
  Package,
} from "lucide-react";

import type {
  ClientOrderBatch,
  ClientOrderDetail,
  TimelineStageKey,
} from "@/domain/client/portal";
import { cn } from "@/lib/utils";
import type { BatchStatus } from "@/types/database";

import { formatDate } from "../../portal-format";
import { usePortalI18n } from "../../portal-i18n-provider";
import { BatchStatusPill, OrderStatusPill } from "../../portal-ui";

/**
 * Detalhe do pedido no portal do cliente. Só apresentação — a leitura já veio
 * escopada por `clientId` na page. Linha do tempo do pedido + o pedido quebrado
 * por LOTE, com barra de progresso por lote e o toggle "By batch / All
 * products". Textos no idioma do portal (`usePortalI18n`).
 *
 * O que não aparece não é esquecimento: quantidade e descrição de produto não
 * existem no banco (ver domain/client/portal.ts). O produto é a linha
 * FÁBRICA × CATEGORIA, com as duas em colunas separadas. Documentos, histórico e mensagens dependem de
 * decisão + backend que ainda não existem → "coming soon", nunca dado fabricado.
 */

type Tab = "batches" | "documents" | "history" | "messages";
type Grouping = "batch" | "flat";

/** Ciclo de vida que o cliente acompanha, sem in_negotiation nem canceled. */
const STEPS: BatchStatus[] = ["in_production", "preloading", "in_transit", "delivered"];

/** Estágio da linha do tempo → status de lote equivalente (mesmo nome na tela). */
const STAGE_AS_BATCH: Record<TimelineStageKey, BatchStatus> = {
  in_production: "in_production",
  pre_loading: "preloading",
  in_transit: "in_transit",
  delivered: "delivered",
};

/** Em que passo do ciclo o lote está. -1 = fora do fluxo (negotiation/canceled). */
const BATCH_STEP: Record<BatchStatus, number> = {
  in_negotiation: -1,
  in_production: 0,
  preloading: 1,
  in_transit: 2,
  delivered: 3,
  canceled: -1,
};

const distinct = (xs: string[]) => [...new Set(xs)];

/** Barra de 4 passos para um lote. */
function BatchProgress({ status }: { status: BatchStatus }) {
  const { t } = usePortalI18n();
  const current = BATCH_STEP[status];
  return (
    <div className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-4">
      {STEPS.map((step, i) => {
        const done = current > i;
        const active = current === i;
        return (
          <div key={step} className="min-w-0">
            <div
              className={cn(
                "h-1 rounded-full",
                done ? "bg-primary" : active ? "bg-violet-400" : "bg-slate-200"
              )}
            />
            <div
              className={cn(
                "mt-1.5 text-[11px] font-medium",
                current >= i ? "text-slate-800" : "text-slate-400"
              )}
            >
              {t.batchStatus[step]}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BatchCard({ batch }: { batch: ClientOrderBatch }) {
  const { t } = usePortalI18n();
  const td = t.detail;
  const count = batch.products.length;
  // Slot direito: entrega (se o lote já chegou) ou ETA ao Brasil — as duas do
  // PL em que o lote viaja.
  const delivered = batch.status === "delivered" || !!batch.deliveredOn;
  const date = formatDate(delivered ? batch.deliveredOn : batch.eta);
  return (
    // Dois cartões separados de propósito: um para os DADOS do lote (código,
    // status, ETA, progresso) e outro para a LISTA de produtos.
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl border bg-white">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-slate-50/80 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <span className="font-mono text-[15px] font-medium text-slate-900">
                {td.batch} {batch.code}
              </span>
              <BatchStatusPill status={batch.status} />
            </div>
            <div className="mt-1 truncate text-xs text-slate-500">
              {t.common.products(count)}
              {count > 0 ? ` · ${distinct(batch.products.map((p) => p.category)).join(", ")}` : ""}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
              {delivered ? td.delivered : td.eta}
            </div>
            {/* Só a data vira monospace; "a confirmar" é texto. */}
            <div className={cn("mt-0.5 text-[13px] text-slate-700", date && "font-mono")}>
              {date ?? (delivered ? "—" : t.common.toBeConfirmed)}
            </div>
          </div>
        </div>

        <BatchProgress status={batch.status} />
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white">
        {count > 0 ? (
          <div role="table" className="text-sm">
            {/* Mesmo grid de 4 colunas do stepper do lote — Factory, Category e
                Ship req. caem sob os 3 primeiros passos, alinhados de propósito.
                A 4ª coluna fica para a quantidade, quando o GSS mandar. */}
            <div
              role="row"
              className="grid grid-cols-3 gap-3 border-b bg-slate-50/80 px-5 py-3 text-left sm:grid-cols-4"
            >
              <span role="columnheader" className="text-xs font-semibold whitespace-nowrap text-slate-500">
                {td.factory}
              </span>
              <span role="columnheader" className="text-xs font-semibold whitespace-nowrap text-slate-500">
                {td.category}
              </span>
              <span role="columnheader" className="text-xs font-semibold whitespace-nowrap text-slate-500">
                {td.shipReq}
              </span>
            </div>
            {batch.products.map((product, i) => (
              <div
                key={`${product.factory}-${product.category}-${i}`}
                role="row"
                className="grid grid-cols-3 gap-3 border-b px-5 py-3.5 last:border-0 sm:grid-cols-4"
              >
                <span
                  role="cell"
                  className="min-w-0 truncate text-slate-600"
                  title={product.factory ?? undefined}
                >
                  {product.factory ?? "—"}
                </span>
                <span role="cell" className="min-w-0 truncate font-medium text-slate-800">
                  {product.category}
                </span>
                <span role="cell" className="font-mono text-xs text-slate-500">
                  {formatDate(product.shipRequirement) ?? "—"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-5 py-5 text-sm text-slate-400">{td.noProductsBatch}</p>
        )}
      </div>
    </div>
  );
}

/** Canto direito do cabeçalho: quando chega (ETA) ou quando chegou. */
function ExpectedDelivery({ order }: { order: ClientOrderDetail }) {
  const { t } = usePortalI18n();
  const delivered = order.status === "delivered";
  const date = formatDate(delivered ? order.deliveredOn : order.etaBrazil);
  if (order.status === "canceled") return null;
  return (
    <div className="sm:text-right">
      <div className="text-xs text-slate-400">
        {delivered ? t.detail.deliveredOn : t.detail.expectedDelivery}
      </div>
      {date ? (
        <div
          className={cn(
            "mt-0.5 font-mono text-lg font-medium",
            order.daysLate ? "text-red-600" : "text-slate-900"
          )}
        >
          {date}
        </div>
      ) : (
        <div className="mt-0.5 text-sm text-slate-400">{t.common.toBeConfirmed}</div>
      )}
    </div>
  );
}

/**
 * Linha do tempo do pedido: 4 estágios com a data real de cada um (ou a
 * prevista, nos que faltam) + onde a carga está agora e o % de progresso.
 */
function OrderProgress({ order }: { order: ClientOrderDetail }) {
  const { t } = usePortalI18n();
  const canceled = order.status === "canceled";
  return (
    <section className="rounded-2xl border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">{t.detail.orderProgress}</h2>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl bg-slate-50 py-1.5 pr-1.5 pl-3 text-sm">
          <MapPin className="size-4 shrink-0 text-primary" />
          <span className="text-slate-400">{t.detail.currentLocation}</span>
          <span className="font-medium text-slate-700">{t.location[order.status]}</span>
          {!canceled ? (
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground tabular-nums">
              {order.progressPct}%
            </span>
          ) : null}
        </div>
      </div>

      <ol className="mt-6 grid gap-4 sm:grid-cols-4 sm:gap-0">
        {order.timeline.map((stage, i) => {
          const last = i === order.timeline.length - 1;
          const date = formatDate(stage.date);
          return (
            <li
              key={stage.key}
              className="relative flex gap-3 sm:flex-col sm:items-center sm:gap-0 sm:text-center"
            >
              {/* Conector até o próximo estágio (só no horizontal). */}
              {!last ? (
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-3.5 left-[calc(50%+18px)] hidden h-0.5 w-[calc(100%-36px)] sm:block",
                    stage.state === "done" ? "bg-primary" : "bg-slate-200"
                  )}
                />
              ) : null}
              <span
                className={cn(
                  "relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-full border-2",
                  stage.state === "done" && "border-primary bg-primary text-white",
                  stage.state === "current" && "border-primary bg-white",
                  stage.state === "upcoming" && "border-slate-200 bg-white"
                )}
              >
                {stage.state === "done" ? <Check className="size-4" /> : null}
                {stage.state === "current" ? (
                  <span className="size-2.5 rounded-full bg-primary" />
                ) : null}
              </span>
              <div className="min-w-0 sm:mt-2.5">
                <div
                  className={cn(
                    "text-sm font-medium",
                    stage.state === "upcoming" ? "text-slate-400" : "text-slate-800"
                  )}
                >
                  {t.batchStatus[STAGE_AS_BATCH[stage.key]]}
                </div>
                <div
                  className={cn(
                    "mt-0.5 text-xs",
                    stage.state === "current" ? "text-primary" : "text-slate-400"
                  )}
                >
                  {canceled ? "—" : t.stageState[stage.state]}
                </div>
                {date && !canceled ? (
                  <div className="mt-1 text-xs text-slate-500">
                    {stage.dateKind === "expected" ? `${t.common.expected} ` : ""}
                    <span className="font-mono">{date}</span>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ComingSoon({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof FileText;
  title: string;
  description: string;
}) {
  const { t } = usePortalI18n();
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-white px-6 py-16 text-center">
      <Icon className="size-7 text-slate-300" />
      <p className="mt-1 text-sm font-semibold text-slate-700">{title}</p>
      <p className="max-w-sm text-sm text-slate-500">{description}</p>
      <span className="mt-1 inline-flex items-center rounded-full border bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-500">
        {t.detail.comingSoon}
      </span>
    </div>
  );
}

export function PortalOrderDetail({ order }: { order: ClientOrderDetail }) {
  const { t } = usePortalI18n();
  const td = t.detail;
  const [tab, setTab] = useState<Tab>("batches");
  const [grouping, setGrouping] = useState<Grouping>("batch");

  const hasBatches = order.batches.length > 0;
  // Soma bruta (sem deduplicar): cada linha Factory×Category conta, mesmo
  // repetindo categoria — casa com o que a tabela por lote mostra.
  const productLines =
    order.batches.reduce((sum, b) => sum + b.products.length, 0) + order.pendingProducts.length;
  const scheduleReq = formatDate(order.scheduleRequested);

  // "All products": cada linha fábrica × categoria com o lote em que viaja e o
  // status do lote.
  const flatProducts = order.batches.flatMap((b) =>
    b.products.map((p) => ({
      factory: p.factory,
      category: p.category,
      shipRequirement: p.shipRequirement,
      batch: b.code,
      status: b.status,
    }))
  );

  const tabs: { id: Tab; label: string; icon: typeof Package; count?: number }[] = [
    { id: "batches", label: td.tabBatches, icon: Package, count: order.batches.length },
    { id: "documents", label: td.tabDocuments, icon: FileText },
    { id: "history", label: td.tabHistory, icon: Clock },
    { id: "messages", label: td.tabMessages, icon: MessageSquare },
  ];

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-1 duration-300">
      <Link
        href="/portal/orders"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:underline"
      >
        <ArrowLeft className="size-4" />
        {t.nav.myOrders}
      </Link>

      {/* Cabeçalho do pedido. */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border bg-white p-6">
        <div className="min-w-0">
          <div className="font-mono text-2xl font-medium text-slate-900">#{order.po_number}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
            {order.client_reference ? (
              <span>
                {td.yourReference}{" "}
                <strong className="font-semibold text-slate-700">{order.client_reference}</strong>
              </span>
            ) : null}
            {order.client_reference && (order.type || hasBatches) ? (
              <span aria-hidden className="text-slate-300">·</span>
            ) : null}
            {order.type ? <span>{order.type}</span> : null}
            {order.type && hasBatches ? (
              <span aria-hidden className="text-slate-300">·</span>
            ) : null}
            {hasBatches ? (
              <span>
                {t.common.batches(order.batches.length)} · {td.productLines(productLines)}
              </span>
            ) : null}
          </div>
          {scheduleReq ? (
            <div className="mt-2 text-xs text-slate-400">
              {td.scheduleReq} <span className="font-mono">{scheduleReq}</span>
            </div>
          ) : null}
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <OrderStatusPill status={order.status} />
            {order.daysLate ? (
              <span className="inline-flex items-center rounded-[4px] border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-red-600">
                {td.delayed(order.daysLate)}
              </span>
            ) : null}
          </div>
          <ExpectedDelivery order={order} />
        </div>
      </div>

      <OrderProgress order={order} />

      {/* Abas + toggle de agrupamento (só na aba Batches). */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-xl border bg-white p-1">
          {tabs.map((tb) => {
            const activeTab = tab === tb.id;
            return (
              <button
                key={tb.id}
                type="button"
                onClick={() => setTab(tb.id)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                  activeTab
                    ? "bg-accent text-accent-foreground"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                )}
              >
                <tb.icon className="size-4" />
                {tb.label}
                {typeof tb.count === "number" ? (
                  <span className="font-mono text-[11px] text-slate-400">{tb.count}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        {tab === "batches" && hasBatches ? (
          <div className="flex gap-1 rounded-xl border bg-white p-1">
            {(["batch", "flat"] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGrouping(g)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  grouping === g ? "bg-slate-100 text-slate-800" : "text-slate-400 hover:text-slate-600"
                )}
              >
                {g === "batch" ? td.byBatch : td.allProducts}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {tab === "batches" ? (
        !hasBatches && order.pendingProducts.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-white px-6 py-16 text-center">
            <Package className="mx-auto size-8 text-slate-300" />
            <p className="mt-3 text-sm text-slate-500">{td.noProductsOrder}</p>
          </div>
        ) : grouping === "batch" ? (
          <div className="space-y-3">
            {order.batches.map((batch) => (
              <BatchCard key={batch.id} batch={batch} />
            ))}

            {order.pendingProducts.length > 0 ? (
              <section className="rounded-2xl border border-dashed bg-white p-5">
                <p className="text-sm font-medium text-slate-500">{td.notInProductionYet}</p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {order.pendingProducts.map((product, i) => (
                    <li
                      key={`${product.factory}-${product.category}-${i}`}
                      className="rounded-lg border bg-white px-3 py-1.5 text-sm text-slate-500"
                    >
                      {product.factory ? (
                        <span className="text-slate-400">{product.factory} · </span>
                      ) : null}
                      {product.category}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {hasBatches ? <p className="text-xs text-slate-400">{td.batchFootnote}</p> : null}
          </div>
        ) : (
          // All products — cada categoria com o lote e o status do lote.
          <div className="overflow-hidden rounded-2xl border bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-slate-50/80 text-left">
                    <th className="px-5 py-3 text-xs font-semibold whitespace-nowrap text-slate-500">
                      {td.factory}
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold whitespace-nowrap text-slate-500">
                      {td.category}
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold whitespace-nowrap text-slate-500">
                      {td.shipReq}
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold whitespace-nowrap text-slate-500">
                      {td.batchNo}
                    </th>
                    <th className="px-5 py-3 text-xs font-semibold whitespace-nowrap text-slate-500">
                      {td.status}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {flatProducts.map((p, i) => (
                    <tr key={`${p.factory}-${p.category}-${p.batch}-${i}`} className="border-b last:border-0">
                      <td className="px-5 py-3.5 text-slate-600">{p.factory ?? "—"}</td>
                      <td className="px-4 py-3.5 font-medium text-slate-800">{p.category}</td>
                      <td className="px-4 py-3.5 font-mono text-xs text-slate-500">
                        {formatDate(p.shipRequirement) ?? "—"}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs text-slate-500">{p.batch}</td>
                      <td className="px-5 py-3.5">
                        <BatchStatusPill status={p.status} />
                      </td>
                    </tr>
                  ))}
                  {order.pendingProducts.map((p, i) => (
                    <tr key={`pending-${p.factory}-${p.category}-${i}`} className="border-b last:border-0">
                      <td className="px-5 py-3.5 text-slate-600">{p.factory ?? "—"}</td>
                      <td className="px-4 py-3.5 font-medium text-slate-800">{p.category}</td>
                      <td className="px-4 py-3.5 text-slate-300">—</td>
                      <td className="px-4 py-3.5 text-slate-300">—</td>
                      <td className="px-5 py-3.5 text-xs text-slate-400">{td.notInProductionYet}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : null}

      {tab === "documents" ? (
        <ComingSoon icon={FileText} title={td.documentsTitle} description={td.documentsText} />
      ) : null}

      {tab === "history" ? (
        <ComingSoon icon={Clock} title={td.historyTitle} description={td.historyText} />
      ) : null}

      {tab === "messages" ? (
        <ComingSoon icon={MessageSquare} title={td.messagesTitle} description={td.messagesText} />
      ) : null}
    </div>
  );
}
