import type { ChecklistStep, EmailThreadKind } from "@/types/database";

/**
 * Qual das 2 conversas de e-mail da Order (`email_threads.kind`) cada etapa
 * do checklist alimenta — ver docs/regras_de_negocio.md (threading por Order).
 *
 * Atualizado 16/09/2026: TODAS as etapas ficam em "internal" por enquanto —
 * a AGK ainda não definiu quais etapas são conversa "external" de verdade, e
 * ter 2 threads por Order (uma delas quase sempre vazia) estava confundindo
 * os próprios testes. A distinção internal/external não foi removida, só
 * zerada: quando a AGK definir o mapeamento de verdade, é só trocar os
 * valores aqui, nada mais depende disso (era a decisão de 11/09/2026, que só
 * marcava as 2 etapas de pagamento como "external").
 *
 * Isto decide apenas em qual thread o envio entra (cabeçalhos/Reply-To); o
 * destinatário continua escolhido à mão a cada envio, e "cliente vs. interno"
 * de cada destinatário (variante do HTML) é um eixo independente, por papel.
 */
const STEP_THREAD_KIND: Record<ChecklistStep, EmailThreadKind> = {
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

export function threadKindForStep(step: ChecklistStep): EmailThreadKind {
  return STEP_THREAD_KIND[step];
}
