import Link from "next/link";
import { ArrowLeft, Package } from "lucide-react";

import type { ClientOrderDetail } from "@/domain/client/portal";
import { ORDER_STATUS_LABELS } from "@/lib/status-colors";
import { StatusPill } from "@/components/status-pill";

/**
 * Detalhe do pedido no portal do cliente. Só apresentação — a leitura já veio
 * escopada por `clientId` na page. Mostra os produtos agrupados por estágio,
 * sem citar lote nem qualquer campo interno da AGK.
 */
export function PortalOrderDetail({ order }: { order: ClientOrderDetail }) {
  const hasProducts = order.stages.length > 0 || order.pendingProducts.length > 0;

  return (
    <div className="space-y-6">
      <Link
        href="/portal"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft className="size-4" />
        Back to my orders
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900">Order #{order.po_number}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
            {order.type ? <span>{order.type}</span> : null}
            {order.client_reference ? (
              <span>
                <span className="text-slate-400">Your reference: </span>
                {order.client_reference}
              </span>
            ) : null}
          </div>
        </div>
        <StatusPill label={ORDER_STATUS_LABELS[order.status]} />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-700">Products by stage</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          See where each part of your order stands and exactly which products travel in it.
        </p>
      </div>

      {!hasProducts ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
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
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <StatusPill label={stage.label} />
                <span className="text-xs text-slate-400">
                  {stage.products.length}{" "}
                  {stage.products.length === 1 ? "product" : "products"}
                </span>
              </div>
              <ul className="mt-4 flex flex-wrap gap-2">
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
            <section className="rounded-xl border border-dashed border-slate-200 bg-white p-5">
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
  );
}
