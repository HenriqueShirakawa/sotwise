import type { ChecklistStep } from "@/types/database";

/**
 * ⚠️ PLACEHOLDER — todo mundo "internal" até o Rapha definir o mapeamento
 * real de qual etapa é conversa interna e qual é externa (ver plano de
 * threading em docs/regras_de_negocio.md). NÃO ativar em produção como
 * fonte de verdade de destinatário — hoje só decide em qual `email_threads`
 * um envio entra, o destinatário continua escolhido à mão por envio.
 */
const STEP_THREAD_KIND: Record<ChecklistStep, "internal" | "external"> = {
  order: "internal",
  po: "internal",
  pi: "internal",
  deposit_payment: "internal",
  packing_confirm: "internal",
  condition_confirm: "internal",
  place_the_order: "internal",
  etd: "internal",
  balance_payment: "internal",
  pre_loading: "internal",
  consolidation_point: "internal",
  city: "internal",
  port_of_loading: "internal",
  shipping_docs: "internal",
  agents: "internal",
  booking: "internal",
  loading_date: "internal",
  shipping_date: "internal",
  bl: "internal",
  original_docs: "internal",
  inspection_report: "internal",
  eta_brazil: "internal",
  ata_brazil: "internal",
  delivered: "internal",
};

export function threadKindForStep(step: ChecklistStep): "internal" | "external" {
  return STEP_THREAD_KIND[step];
}
