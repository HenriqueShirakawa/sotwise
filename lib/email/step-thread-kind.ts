import type { ChecklistStep, EmailThreadKind } from "@/types/database";

/**
 * Qual das 2 conversas de e-mail da Order (`email_threads.kind`) cada etapa
 * do checklist alimenta — ver docs/regras_de_negocio.md (threading por Order).
 *
 * Decisão do usuário em 11/09/2026: por enquanto SÓ as duas etapas de
 * pagamento são conversa "external" (com o cliente); todo o resto fica na
 * "internal" (equipe). O mapeamento definitivo vai ser definido pelo cliente
 * (AGK) — quando chegar, é só trocar valores aqui, nada mais depende disso.
 *
 * Isto decide apenas em qual thread o envio entra (cabeçalhos/Reply-To); o
 * destinatário continua escolhido à mão a cada envio, e "cliente vs. interno"
 * de cada destinatário (variante do HTML) é um eixo independente, por papel.
 */
const STEP_THREAD_KIND: Record<ChecklistStep, EmailThreadKind> = {
  order: "internal",
  po: "internal",
  pi: "internal",
  deposit_payment: "external",
  packing_confirm: "internal",
  condition_confirm: "internal",
  place_the_order: "internal",
  etd: "internal",
  balance_payment: "external",
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
