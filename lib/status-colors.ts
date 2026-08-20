import type { CSSProperties } from "react";

import type { BatchStatus, LoadingStatus, OrderStatus } from "@/types/database";

/**
 * Paleta de status compartilhada (Orders + Batches). Chave = label exibido.
 * Roundness dos chips é fixo em 4px (ver StatusChip nos componentes).
 *
 * As cores são aplicadas via inline style (não classes Tailwind arbitrárias)
 * porque o hex é resolvido em runtime — o JIT do Tailwind só enxerga classes
 * estáticas no código-fonte.
 */
export const STATUS_COLORS: Record<string, string> = {
  "Stand by": "#091747",
  "In Negotiation": "#9E450E",
  "In Production": "#9A1A1E",
  "Partially Preloading": "#C026D3",
  "Pre-Loading": "#9500A8",
  "In Transit": "#9E450E",
  "Partially Shipped": "#0B5CAD",
  Shipped: "#1D4ED8",
  "Partially Delivered": "#15803D",
  Delivered: "#085D4A",
  Canceled: "#B91C1C",
};

export function statusChipStyle(hex: string): CSSProperties {
  return {
    borderColor: `${hex}59`, // ~35%
    backgroundColor: "#ffffff",
    color: hex,
  };
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  in_negotiation: "In Negotiation",
  in_production: "In Production",
  partially_preloading: "Partially Preloading",
  pre_loading: "Pre-Loading",
  partially_shipped: "Partially Shipped",
  shipped: "Shipped",
  partially_delivered: "Partially Delivered",
  delivered: "Delivered",
  canceled: "Canceled",
};

export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  in_negotiation: "In Negotiation",
  in_production: "In Production",
  preloading: "Pre-Loading",
  in_transit: "In Transit",
  delivered: "Delivered",
  canceled: "Canceled",
};

/**
 * Carga do embarque (`order_factory_category.loading_status`): se aquela entrada
 * Factory×Category embarcou Total, Parcial ou nada (docs §3.7.x). Definida por
 * entrada, não pelo lote — um lote pode misturar Total e Partial.
 */
export const LOADING_STATUS_LABELS: Record<LoadingStatus, string> = {
  total: "Total",
  partial: "Partial",
  none: "None",
};

export const LOADING_STATUS_STYLES: Record<LoadingStatus, string> = {
  total: "border-emerald-200 bg-emerald-50 text-emerald-700",
  partial: "border-amber-200 bg-amber-50 text-amber-700",
  none: "border-slate-200 bg-slate-50 text-slate-500",
};
