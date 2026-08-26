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

import type { ClientOrderDetail } from "@/domain/client/portal";
import { ORDER_STATUS_LABELS } from "@/lib/status-colors";
import { StatusPill } from "@/components/status-pill";
import { cn } from "@/lib/utils";
import type { BatchStatus, OrderStatus } from "@/types/database";

/**
 * Detalhe do pedido no portal do cliente. Só apresentação — a leitura já veio
 * escopada por `clientId` na page. Mostra os produtos agrupados por estágio,
 * sem citar lote nem qualquer campo interno da AGK (recorte de 2026-08-18).
 *
 * O shell de abas (Products / Documents / History / Messages) espelha o desenho
 * do portal, mas só "Products" está ligado a dado real: documentos, histórico e
 * mensagens dependem de decisão de exposição + backend que ainda não existem, e
 * por isso entram como "coming soon" — nunca com dado fabricado.
 */

type Tab = "products" | "documents" | "history" | "messages";

/** Ciclo de vida que o cliente acompanha — o mesmo dos lotes, sem in_negotiation
 *  nem canceled (que não são etapas do fluxo feliz). */
const STEPS: { status: BatchStatus; label: string }[] = [
  { status: "in_production", label: "In Production" },
  { status: "preloading", label: "Pre-Loading" },
  { status: "in_transit", label: "In Transit" },
  { status: "delivered", label: "Delivered" },
];

/** Em que passo do ciclo o pedido está, a partir do status do pedido. */
const STATUS_STEP: Record<OrderStatus, number> = {
  in_negotiation: -1,
  in_production: 0,
  partially_preloading: 1,
  pre_loading: 1,
  partially_shipped: 2,
  shipped: 2,
  partially_delivered: 3,
  delivered: 3,
  canceled: -1,
};

function StageProgress({ order }: { order: ClientOrderDetail }) {
  const current = STATUS_STEP[order.status];
  // Quantos produtos há em cada estágio do ciclo — para dar peso a cada passo.
  const countByStatus = new Map(order.stages.map((s) => [s.status, s.products.length]));

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {STEPS.map((step, i) => {
        const done = current > i;
        const active = current === i;
        const count = countByStatus.get(step.status) ?? 0;
        return (
          <div key={step.status} className="min-w-0">
            <div
              className="h-1 rounded-full"
              style={{
                backgroundColor: done ? "#640bb7" : active ? "#c084fc" : "#e2e8f0",
              }}
            />
            <div
              className={cn(
                "mt-1.5 text-[11px] font-medium",
                current >= i ? "text-slate-800" : "text-slate-400"
              )}
            >
              {step.label}
            </div>
            {count > 0 ? (
              <div className="mt-0.5 font-mono text-[10px] text-slate-400">
                {count} {count === 1 ? "product" : "products"}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ComingSoon({ icon: Icon, title, description }: {
  icon: typeof FileText;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
      <Icon className="size-7 text-slate-300" />
      <p className="mt-1 text-sm font-semibold text-slate-700">{title}</p>
      <p className="max-w-sm text-sm text-slate-500">{description}</p>
      <span className="mt-1 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-500">
        Coming soon
      </span>
    </div>
  );
}

export function PortalOrderDetail({ order }: { order: ClientOrderDetail }) {
  const [tab, setTab] = useState<Tab>("products");

  const hasProducts = order.stages.length > 0 || order.pendingProducts.length > 0;
  const productCount =
    new Set([...order.stages.flatMap((s) => s.products), ...order.pendingProducts]).size;

  const tabs: { id: Tab; label: string; icon: typeof Package }[] = [
    { id: "products", label: "Products", icon: Package },
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

      {/* Cabeçalho do pedido — cartão no lugar do título solto (desenho do portal). */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-6">
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
            {order.client_reference && (order.type || productCount > 0) ? (
              <span aria-hidden className="text-slate-300">
                ·
              </span>
            ) : null}
            {order.type ? <span>{order.type}</span> : null}
            {order.type && productCount > 0 ? (
              <span aria-hidden className="text-slate-300">
                ·
              </span>
            ) : null}
            {productCount > 0 ? (
              <span>
                {productCount} product {productCount === 1 ? "line" : "lines"}
              </span>
            ) : null}
          </div>
        </div>
        <StatusPill label={ORDER_STATUS_LABELS[order.status]} />
      </div>

      {/* Barra de abas — segmented control do desenho. */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">
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
            </button>
          );
        })}
      </div>

      {tab === "products" ? (
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-700">Progress</h2>
            <p className="mt-0.5 mb-5 text-sm text-slate-500">
              See where each part of your order stands and exactly which products travel in it.
            </p>
            <StageProgress order={order} />
          </div>

          {!hasProducts ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
              <Package className="mx-auto size-8 text-slate-300" />
              <p className="mt-3 text-sm text-slate-500">
                No products to show for this order yet.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {order.stages.map((stage) => (
                <section
                  key={stage.status}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
                >
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-[#fbfaff] px-5 py-4">
                    <StatusPill label={stage.label} />
                    <span className="text-xs text-slate-400">
                      {stage.products.length}{" "}
                      {stage.products.length === 1 ? "product" : "products"}
                    </span>
                  </div>
                  <ul className="flex flex-wrap gap-2 p-5">
                    {stage.products.map((product) => (
                      <li
                        key={product}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700"
                      >
                        {product}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}

              {order.pendingProducts.length > 0 ? (
                <section className="rounded-2xl border border-dashed border-slate-200 bg-white p-5">
                  <p className="text-sm font-medium text-slate-500">Not in production yet</p>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {order.pendingProducts.map((product) => (
                      <li
                        key={product}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-500"
                      >
                        {product}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          )}
        </div>
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
