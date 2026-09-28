import type { ChecklistStep, EmailThreadKind } from "@/types/database";

/**
 * Posição INICIAL do switch "Include client" do compositor, por etapa —
 * `external` abre ligado (conversa com o cliente), `internal` abre desligado
 * (só a equipe). Ver docs/regras_de_negocio.md (switch "Include client").
 *
 * Desde 28/09/2026 quem decide a thread de cada envio é o switch, não mais
 * este mapa (pedido do usuário: a AGK ainda não mandou a lista de etapas que
 * envolvem o cliente, então a escolha fica na mão de quem envia). Tudo
 * `internal` = o compositor sempre abre em "só equipe"; quando a lista da AGK
 * chegar, trocar aqui só muda de que lado o switch nasce em cada etapa —
 * continua dando pra virar na hora.
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

export function defaultThreadKindForStep(step: ChecklistStep): EmailThreadKind {
  return STEP_THREAD_KIND[step];
}
