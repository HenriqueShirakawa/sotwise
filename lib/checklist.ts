import type { ChecklistStep } from "@/types/database";

/**
 * Rótulos das 24 etapas do checklist (docs §3.7.5 / §3.9.5 / §3.10.4), na
 * grafia usada nas telas de Order/Pre-loading/Shipment. Centralizado aqui pra
 * a To do list e as telas de detalhe compartilharem uma única fonte.
 */
export const STEP_LABELS: Record<ChecklistStep, string> = {
  order: "Order",
  po: "PO",
  pi: "PI",
  deposit_payment: "Deposit Payment",
  packing_confirm: "Packing Confirm.",
  condition_confirm: "Condition Confirm.",
  place_the_order: "Place the Order",
  etd: "ETD",
  balance_payment: "Balance Payment",
  pre_loading: "Pre-Loading",
  consolidation_point: "Consolidation point",
  city: "City",
  port_of_loading: "Port of loading",
  shipping_docs: "Shipping docs",
  agents: "Agents",
  booking: "Booking",
  loading_date: "Loading date",
  shipping_date: "Shipping date",
  bl: "BL",
  original_docs: "Original docs",
  inspection_report: "Inspection report",
  eta_brazil: "ETA Brazil",
  ata_brazil: "ATA Brazil",
  delivered: "Delivered",
};

/** Ordem canônica das etapas (Order #1–9 → Pre-loading/Shipment #10–24). */
export const CHECKLIST_STEP_ORDER: ChecklistStep[] = Object.keys(
  STEP_LABELS
) as ChecklistStep[];
