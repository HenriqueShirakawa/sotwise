"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Clock,
  FileText,
  MessageSquare,
  Package,
} from "lucide-react";

import type { ClientOrderBatch, ClientOrderDetail } from "@/domain/client/portal";
import { ORDER_STATUS_LABELS } from "@/lib/status-colors";
import { StatusPill } from "@/components/status-pill";
import { cn } from "@/lib/utils";
import type { BatchStatus } from "@/types/database";

/**
 * Detalhe do pedido no portal do cliente. Só apresentação — a leitura já veio
 * escopada por `clientId` na page. Segue o desenho do Claude Design: o pedido
 * quebrado por LOTE, com barra de progresso por lote e o toggle "By batch /
 * All products".
 *
 * O que não aparece não é esquecimento: quantidade, descrição e datas por etapa
 * não existem no banco (ver domain/client/portal.ts). O produto fica na
 * granularidade de CATEGORIA. Documentos, histórico e mensagens dependem de
 * decisão + backend que ainda não existem → "coming soon", nunca dado fabricado.
 */

type Tab = "batches" | "documents" | "history" | "messages";
type Grouping = "batch" | "flat";

/** Ciclo de vida que o cliente acompanha, sem in_negotiation nem canceled. */
const STEPS: { status: BatchStatus; label: string }[] = [
  { status: "in_production", label: "In Production" },
  { status: "preloading", label: "Pre-Loading" },
  { status: "in_transit", label: "In Transit" },
  { status: "delivered", label: "Delivered" },
];

/** Em que passo do ciclo o lote está. -1 = fora do fluxo (negotiation/canceled). */
const BATCH_STEP: Record<BatchStatus, number> = {
  in_negotiation: -1,
  in_production: 0,
  preloading: 1,
  in_transit: 2,
  delivered: 3,
  canceled: -1,
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

/** Barra de 4 passos para um lote — sem datas por etapa (o banco não guarda). */
function BatchProgress({ status }: { status: BatchStatus }) {
  const current = BATCH_STEP[status];
  return (
    <div className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-4">
      {STEPS.map((step, i) => {
        const done = current > i;
        const active = current === i;
        return (
          <div key={step.status} className="min-w-0">
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
              {step.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BatchCard({
  batch,
  eta,
}: {
  batch: ClientOrderBatch;
  eta: { label: string; value: string };
}) {
  const count = batch.products.length;
  // Um único elemento monospace por dado, nunca o rótulo junto — "to be
  // confirmed" não é código, então só a data (quando existe) vira mono.
  const etaIsDate = eta.value !== "to be confirmed" && eta.value !== "—";
  return (
    // Dois cartões separados de propósito: um para os DADOS do lote (código,
    // status, ETA, progresso) e outro para a LISTA de produtos — misturar os
    // dois num container só escondia a fronteira entre "sobre o lote" e "o
    // que viaja nele".
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl border bg-white">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-slate-50/80 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <span className="font-mono text-[15px] font-medium text-slate-900">
                Batch {batch.code}
              </span>
              <StatusPill label={batch.label} />
            </div>
            <div className="mt-1 truncate text-xs text-slate-500">
              {count} {count === 1 ? "product" : "products"}
              {count > 0 ? ` · ${batch.products.map((p) => p.name).join(", ")}` : ""}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[10px] tracking-[0.08em] text-slate-400 uppercase">
              {eta.label}
            </div>
            <div
              className={cn(
                "mt-0.5 text-[13px] text-slate-700",
                etaIsDate ? "font-mono" : "font-sans"
              )}
            >
              {eta.value}
            </div>
          </div>
        </div>

        <BatchProgress status={batch.status} />
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white">
        {count > 0 ? (
          <div role="table" className="text-sm">
            {/* Mesmo grid de 4 colunas do stepper do lote (grid-cols-2/sm:grid-cols-4,
                px-5, gap-3) — Product cai sob "In Production" e Ship req. sob
                "Pre-Loading", alinhados de propósito. */}
            <div
              role="row"
              className="grid grid-cols-2 gap-3 border-b bg-slate-50/80 px-5 py-3 text-left sm:grid-cols-4"
            >
              <span role="columnheader" className="text-xs font-semibold whitespace-nowrap text-slate-500">
                Product <span className="text-slate-300">↑↓</span>
              </span>
              <span role="columnheader" className="text-xs font-semibold whitespace-nowrap text-slate-500">
                Ship req.
              </span>
            </div>
            {batch.products.map((product, i) => (
              <div
                key={`${product.name}-${i}`}
                role="row"
                className="grid grid-cols-2 gap-3 border-b px-5 py-3.5 last:border-0 sm:grid-cols-4"
              >
                <span role="cell" className="min-w-0 truncate font-medium text-slate-800">
                  {product.name}
                </span>
                <span role="cell" className="font-mono text-xs text-slate-500">
                  {formatDate(product.shipRequirement) ?? "—"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-5 py-5 text-sm text-slate-400">No products in this batch yet.</p>
        )}
      </div>
    </div>
  );
}

function ComingSoon({ icon: Icon, title, description }: {
  icon: typeof FileText;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-white px-6 py-16 text-center">
      <Icon className="size-7 text-slate-300" />
      <p className="mt-1 text-sm font-semibold text-slate-700">{title}</p>
      <p className="max-w-sm text-sm text-slate-500">{description}</p>
      <span className="mt-1 inline-flex items-center rounded-full border bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-500">
        Coming soon
      </span>
    </div>
  );
}

export function PortalOrderDetail({ order }: { order: ClientOrderDetail }) {
  const [tab, setTab] = useState<Tab>("batches");
  const [grouping, setGrouping] = useState<Grouping>("batch");

  const hasBatches = order.batches.length > 0;
  // Soma bruta (sem deduplicar): cada linha Factory×Category conta, mesmo
  // repetindo categoria — casa com o que a tabela por lote mostra.
  const productLines =
    order.batches.reduce((sum, b) => sum + b.products.length, 0) + order.pendingProducts.length;
  const scheduleReq = formatDate(order.scheduleRequested);

  // Slot direito do card do lote: entrega (se o lote já foi) ou ETA ao Brasil
  // (estimativa do pedido). Repetimos a ETA do pedido em cada lote — não há ETA
  // por lote no banco; é a mesma para o pedido inteiro.
  const batchEta = (batch: ClientOrderBatch) =>
    batch.status === "delivered"
      ? { label: "Delivered", value: formatDate(order.deliveredOn) ?? "—" }
      : { label: "ETA", value: formatDate(order.etaBrazil) ?? "to be confirmed" };

  // "All products": cada categoria com o lote em que viaja e o status do lote.
  const flatProducts = order.batches.flatMap((b) =>
    b.products.map((p) => ({
      name: p.name,
      shipRequirement: p.shipRequirement,
      batch: b.code,
      status: b.label,
    }))
  );

  const tabs: { id: Tab; label: string; icon: typeof Package; count?: number }[] = [
    { id: "batches", label: "Batches", icon: Package, count: order.batches.length },
    { id: "documents", label: "Documents", icon: FileText },
    { id: "history", label: "History", icon: Clock },
    { id: "messages", label: "Messages", icon: MessageSquare },
  ];

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-1 duration-300">
      <Link
        href="/portal"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:underline"
      >
        <ArrowLeft className="size-4" />
        My orders
      </Link>

      {/* Cabeçalho do pedido. */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border bg-white p-6">
        <div className="min-w-0">
          <div className="font-mono text-2xl font-medium text-slate-900">
            #{order.po_number}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
            {order.client_reference ? (
              <span>
                Your reference{" "}
                <strong className="font-semibold text-slate-700">
                  {order.client_reference}
                </strong>
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
                {order.batches.length} {order.batches.length === 1 ? "batch" : "batches"} ·{" "}
                {productLines} product {productLines === 1 ? "line" : "lines"}
              </span>
            ) : null}
          </div>
          {scheduleReq ? (
            <div className="mt-2 text-xs text-slate-400">
              Schedule req. <span className="font-mono">{scheduleReq}</span>
            </div>
          ) : null}
        </div>
        <StatusPill label={ORDER_STATUS_LABELS[order.status]} />
      </div>

      {/* Abas + toggle de agrupamento (só na aba Batches). */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-xl border bg-white p-1">
          {tabs.map((t) => {
            const activeTab = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                  activeTab
                    ? "bg-accent text-accent-foreground"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                )}
              >
                <t.icon className="size-4" />
                {t.label}
                {typeof t.count === "number" ? (
                  <span className="font-mono text-[11px] text-slate-400">{t.count}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        {tab === "batches" && hasBatches ? (
          <div className="flex gap-1 rounded-xl border bg-white p-1">
            <button
              type="button"
              onClick={() => setGrouping("batch")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                grouping === "batch"
                  ? "bg-slate-100 text-slate-800"
                  : "text-slate-400 hover:text-slate-600"
              )}
            >
              By batch
            </button>
            <button
              type="button"
              onClick={() => setGrouping("flat")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                grouping === "flat"
                  ? "bg-slate-100 text-slate-800"
                  : "text-slate-400 hover:text-slate-600"
              )}
            >
              All products
            </button>
          </div>
        ) : null}
      </div>

      {tab === "batches" ? (
        !hasBatches && order.pendingProducts.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-white px-6 py-16 text-center">
            <Package className="mx-auto size-8 text-slate-300" />
            <p className="mt-3 text-sm text-slate-500">
              No products to show for this order yet.
            </p>
          </div>
        ) : grouping === "batch" ? (
          <div className="space-y-3">
            {order.batches.map((batch) => (
              <BatchCard key={batch.id} batch={batch} eta={batchEta(batch)} />
            ))}

            {order.pendingProducts.length > 0 ? (
              <section className="rounded-2xl border border-dashed bg-white p-5">
                <p className="text-sm font-medium text-slate-500">Not in production yet</p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {order.pendingProducts.map((product) => (
                    <li
                      key={product}
                      className="rounded-lg border bg-white px-3 py-1.5 text-sm text-slate-500"
                    >
                      {product}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {hasBatches ? (
              <p className="text-xs text-slate-400">
                A batch moves as one block. If part of it doesn&apos;t load, that quantity
                moves to the next batch and you see it here.
              </p>
            ) : null}
          </div>
        ) : (
          // All products — cada categoria com o lote e o status do lote.
          <div className="overflow-hidden rounded-2xl border bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-slate-50/80 text-left">
                    <th className="px-5 py-3 text-xs font-semibold whitespace-nowrap text-slate-500">
                      Product
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold whitespace-nowrap text-slate-500">
                      Ship req.
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold whitespace-nowrap text-slate-500">
                      Batch No.
                    </th>
                    <th className="px-5 py-3 text-xs font-semibold whitespace-nowrap text-slate-500">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {flatProducts.map((p, i) => (
                    <tr key={`${p.name}-${p.batch}-${i}`} className="border-b last:border-0">
                      <td className="px-5 py-3.5 font-medium text-slate-800">{p.name}</td>
                      <td className="px-4 py-3.5 font-mono text-xs text-slate-500">
                        {formatDate(p.shipRequirement) ?? "—"}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs text-slate-500">{p.batch}</td>
                      <td className="px-5 py-3.5">
                        <StatusPill label={p.status} />
                      </td>
                    </tr>
                  ))}
                  {order.pendingProducts.map((name) => (
                    <tr key={`pending-${name}`} className="border-b last:border-0">
                      <td className="px-5 py-3.5 font-medium text-slate-800">{name}</td>
                      <td className="px-4 py-3.5 text-slate-300">—</td>
                      <td className="px-4 py-3.5 text-slate-300">—</td>
                      <td className="px-5 py-3.5 text-xs text-slate-400">Not in production yet</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : null}

      {tab === "documents" ? (
        <ComingSoon
          icon={FileText}
          title="Documents"
          description="Invoices, packing lists and other files for this order will show up here. For now, your AGK contact sends them by e-mail."
        />
      ) : null}

      {tab === "history" ? (
        <ComingSoon
          icon={Clock}
          title="Change history"
          description="A timeline of every movement on this order will live here — newest first."
        />
      ) : null}

      {tab === "messages" ? (
        <ComingSoon
          icon={MessageSquare}
          title="Messages"
          description="Updates from the AGK team about this order will appear here. For now, replies go through your AGK contact by e-mail."
        />
      ) : null}
    </div>
  );
}
