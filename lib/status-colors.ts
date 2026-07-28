import type { CSSProperties } from "react";

import type { BatchStatus, OrderStatus } from "@/types/database";

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
  "Pre-Loading": "#9500A8",
  "In Transit": "#9E450E",
  "Partially Shipped": "#0B5CAD",
  Shipped: "#1D4ED8",
  "Partially Delivered": "#15803D",
  Delivered: "#085D4A",
  Canceled: "#B91C1C",
};

/** Alpha aplicado por trás do hex (formato #RRGGBBAA). */
export function statusChipStyle(hex: string): CSSProperties {
  return {
    borderColor: `${hex}59`, // ~35%
    backgroundColor: `${hex}14`, // ~8%
    color: hex,
  };
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  in_negotiation: "In Negotiation",
  in_production: "In Production",
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
