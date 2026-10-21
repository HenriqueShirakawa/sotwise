import { EVENT_DATE_STEPS } from "@/lib/checklist";
import { todayIso } from "@/lib/format";
import type { ChecklistStep } from "@/types/database";

/**
 * Regra de conclusão ("Checked", ícone verde) de cada etapa do checklist.
 *
 * A base vale para as 24: sem "Completed on" a etapa NÃO fica verde. Algumas
 * exigem mais que a data — documento anexado, um cadastro escolhido, um número
 * digitado —, e essas condições extras estão todas aqui, em UM lugar só, porque
 * as mesmas etapas aparecem em três telas (Order, Pre-loading e Shipment) e o
 * verde precisa significar a mesma coisa nas três.
 *
 * A coluna `done` das tabelas continua sendo só o espelho de `completed_on`
 * (é o que os writers gravam); quem manda no que o usuário vê é `isStepChecked`,
 * aplicado sempre na leitura.
 */

/**
 * O que a regra consulta. Cada tela preenche o que tem — campo ausente conta
 * como vazio, então uma etapa cuja condição depende de um dado que a tela não
 * carregou nunca fica verde por engano.
 */
export type ChecklistFacts = {
  /** Comum às 24 etapas. */
  completedOn: string | null;
  /** Documentos anexados à etapa. */
  attachments?: number;

  // ── fase Order ────────────────────────────────────────────────────────────
  /** PO: entradas Factory × Category cadastradas no pedido. */
  factoryCategoryCount?: number;
  /** Place the Order: quantas fábricas do pedido já têm ao menos um documento. */
  placeOrderFactoriesWithDoc?: number;
  /** ETD: "Initial date" preenchido em TODAS as entradas Factory × Category. */
  etdInitialFilled?: boolean;

  // ── fase Pre-loading ──────────────────────────────────────────────────────
  consolidationPointId?: string | null;
  cityId?: string | null;
  polId?: string | null;
  carrierId?: string | null;
  agentBrazilId?: string | null;
  agentChinaId?: string | null;
  contactBrazilId?: string | null;
  contactChinaId?: string | null;
  /**
   * Quantos contatos o agente Brasil/China escolhido tem cadastrados. Agente sem
   * nenhum contato não pode travar a etapa — não há o que escolher —, então o
   * contato só é exigido quando existe pelo menos um. Ausente conta como zero.
   */
  contactBrazilOptions?: number;
  contactChinaOptions?: number;
  bookingNumber?: string | null;

  // ── fase Shipment ─────────────────────────────────────────────────────────
  /** Shipping Date / ETA / ATA / Delivered: a data do fato (EVENT_DATE_STEPS). */
  eventDate?: string | null;
};

/** Condições ALÉM do "Completed on", em rótulos prontos pra UI. */
function missingExtras(step: ChecklistStep, f: ChecklistFacts): string[] {
  const missing: string[] = [];
  const noDocs = (f.attachments ?? 0) === 0;

  switch (step) {
    // Order, PO e PI fecham pelo próprio gatilho (20/10/2026, lib/checklist-revisions):
    // Order pelo "Order received date", PO pelas Factory × Category que chegam do
    // GSS, PI pelo status vindo do GSS. Sem anexo — o GSS gera os documentos.
    case "po":
      if ((f.factoryCategoryCount ?? 0) === 0) missing.push("Factory × Category entries");
      break;
    case "place_the_order": {
      // Basta UMA fábrica do agrupamento com documento (21/10/2026; antes era
      // cada fábrica). Anexo sem fábrica não conta.
      if ((f.placeOrderFactoriesWithDoc ?? 0) === 0) missing.push("a document for a factory");
      break;
    }
    case "etd":
      // Requisito herdado da tela de Orders: sem entrada não há o que preencher,
      // então `etdInitialFilled` já vem false nesse caso.
      if (!f.etdInitialFilled) missing.push("Initial date on every entry");
      break;
    case "pre_loading":
      if (noDocs) missing.push("a document");
      break;

    case "consolidation_point":
      if (!f.consolidationPointId) missing.push("a consolidation point");
      break;
    case "city":
      if (!f.cityId) missing.push("a city");
      break;
    case "port_of_loading":
      // Cadastro de PORTOS (`pols`), não de fábricas.
      if (!f.polId) missing.push("a port of loading");
      break;
    case "shipping_docs":
      if (noDocs) missing.push("a document");
      break;
    case "agents":
      if (!f.carrierId) missing.push("a carrier");
      if (!f.agentBrazilId) missing.push("an agent Brazil");
      if (!f.agentChinaId) missing.push("an agent China");
      // Contato só é exigência quando o agente escolhido TEM contato cadastrado:
      // parte dos agentes não tem nenhum, e a etapa ficava impossível de fechar.
      if (!f.contactBrazilId && (f.contactBrazilOptions ?? 0) > 0)
        missing.push("a contact Brazil");
      if (!f.contactChinaId && (f.contactChinaOptions ?? 0) > 0)
        missing.push("a contact China");
      break;
    case "booking":
      if (!f.bookingNumber?.trim()) missing.push("the booking number");
      break;

    case "bl":
    case "original_docs":
      if (noDocs) missing.push("a document");
      break;

    // Data do fato (21/10/2026): a etapa fecha quando ela é informada.
    case "shipping_date":
    case "eta_brazil":
    case "ata_brazil":
    case "delivered":
      if (!f.eventDate) missing.push(`the ${EVENT_DATE_STEPS[step]?.toLowerCase() ?? "date"}`);
      break;

    // Inspection Report (oculta desde 21/10) aceitava documento opcional — a
    // etapa fecha só com a data.
    default:
      break;
  }

  return missing;
}

/** O que falta para a etapa ficar Checked. Lista vazia = concluída. */
export function missingForStep(step: ChecklistStep, f: ChecklistFacts): string[] {
  return [
    ...(f.completedOn ? [] : ["a completion date"]),
    ...missingExtras(step, f),
  ];
}

/** A etapa está concluída (verde)? */
export function isStepChecked(step: ChecklistStep, f: ChecklistFacts): boolean {
  return missingForStep(step, f).length === 0;
}

/**
 * A etapa exige algo além do "Completed on"? Derivado das próprias condições
 * (nada preenchido → o que aparecer é exigência da etapa), pra não existir uma
 * segunda lista pra manter em dia. Usado só pelo ícone: etapa com exigência
 * extra ainda pendente é o "i" laranja, não a bolinha azul.
 */
export function hasExtraRequirements(step: ChecklistStep): boolean {
  return missingExtras(step, { completedOn: null }).length > 0;
}

/**
 * Etapas concluídas pelo próprio gatilho (lib/checklist-revisions), 20/10/2026:
 * Order pelo "Order received date", PO pelas Factory × Category do GSS, PI pelo
 * status do GSS, Deposit Payment pelo "Deposit date" que o usuário grava.
 */
export const TRIGGER_COMPLETED_STEPS: ReadonlySet<ChecklistStep> = new Set<ChecklistStep>([
  "order",
  "po",
  "pi",
  "deposit_payment",
]);

/**
 * Etapas com "Completed on" TRAVADO (20/10/2026): quem grava a data é o gatilho
 * da etapa, não a mão — Order/PO/PI/Deposit Payment pelo lib/checklist-revisions,
 * Place the Order quando a 1ª fábrica recebe documento e ETD quando a última
 * Initial Date é preenchida (idem), as do
 * PL/Shipment pela auto-conclusão (lib/pl-step-autocomplete) e Shipping Date/ETA/
 * ATA/Delivered pela data do fato (lib/pl-step-event-date) e Loading date pelo
 * popup do Confirm Shipping (CONFIRM_SHIPPING_COMPLETES). Só admin/owner
 * corrige, com motivo. Cada etapa que ganhar gatilho entra aqui.
 */
export const LOCKED_COMPLETED_ON_STEPS: ReadonlySet<ChecklistStep> = new Set<ChecklistStep>([
  ...TRIGGER_COMPLETED_STEPS,
  "place_the_order",
  "etd",
  "consolidation_point",
  "city",
  "port_of_loading",
  "shipping_docs",
  "agents",
  "booking",
  "loading_date",
  "bl",
  "original_docs",
  "shipping_date",
  "eta_brazil",
  "ata_brazil",
  "delivered",
]);

/**
 * Etapas do PL que o próprio Confirm Shipping conclui (21/10/2026): na tela do
 * Pre-loading a Loading Date tem só Estimated date e Responsible — a data real
 * é informada no popup do embarque, que grava o Completed on. Por isso, para
 * liberar o Confirm Shipping, basta ela ter o Estimated date.
 */
export const CONFIRM_SHIPPING_COMPLETES: ReadonlySet<ChecklistStep> = new Set<ChecklistStep>([
  "loading_date",
]);

/** A etapa do PL já não segura o Confirm Shipping? */
export function isReadyToShip(
  step: ChecklistStep,
  facts: ChecklistFacts,
  estimatedDate: string | null
): boolean {
  if (CONFIRM_SHIPPING_COMPLETES.has(step)) return !!estimatedDate || !!facts.completedOn;
  return isStepChecked(step, facts);
}

export const LOCKED_COMPLETED_ON_ERROR =
  "This step is completed automatically. Only an admin can correct the date, with a reason.";

/**
 * "Completed on" só existe com "Estimated date" preenchido: não se conclui uma
 * etapa que nunca foi prevista. Vale nas três telas de checklist.
 *
 * Só julga quando o patch MEXE numa das duas datas — editar Responsible numa
 * etapa antiga (migrada do Bubble com data de conclusão e sem estimativa) não
 * pode ser barrado por um estado que já estava lá. Limpar o "Completed on"
 * também é sempre permitido, senão essas etapas ficariam presas.
 *
 * Retorna a mensagem de erro, ou null quando o patch é válido.
 */
export function validateStepDates(
  current: { estimated_date: string | null; completed_on: string | null },
  patch: { estimated_date?: string | null; completed_on?: string | null },
  step?: ChecklistStep
): string | null {
  const touchesEstimated = "estimated_date" in patch;
  const touchesCompleted = "completed_on" in patch;
  if (!touchesEstimated && !touchesCompleted) return null;

  // "Completed on" registra um fato consumado — nunca pode ser futuro, em
  // NENHUMA etapa. Só barra quando o patch está DEFININDO a data (não trava
  // estado antigo nem a limpeza da data).
  if (touchesCompleted && patch.completed_on && patch.completed_on > todayIso()) {
    return "The completion date can't be in the future.";
  }

  // Order, PO, PI e Deposit Payment concluem pelo gatilho (received date / GSS /
  // deposit date), que não tem estimativa — a regra "completed exige estimated"
  // não vale para elas.
  if (step && TRIGGER_COMPLETED_STEPS.has(step)) return null;

  const estimated = touchesEstimated ? (patch.estimated_date ?? null) : current.estimated_date;
  const completed = touchesCompleted ? (patch.completed_on ?? null) : current.completed_on;
  if (!completed || estimated) return null;

  return touchesEstimated
    ? "Clear the completion date before removing the estimated date."
    : "Fill in the estimated date before setting the completion date.";
}

/** Linha de `pre_loading_checklist_steps`, no mínimo que a regra consulta. */
export type PlStepFields = {
  completed_on: string | null;
  consolidation_point_id?: string | null;
  city_id?: string | null;
  pol_id?: string | null;
  carrier_id?: string | null;
  agent_brazil_id?: string | null;
  agent_china_id?: string | null;
  contact_brazil_id?: string | null;
  contact_china_id?: string | null;
  booking_number?: string | null;
  event_date?: string | null;
};

/**
 * Adapta uma linha do checklist do PL (etapas #11–24) para os fatos da regra.
 * As leituras dessas etapas — tela de Pre-loading, lista de Pre-loading, tela de
 * Shipment e a trava do Confirm Shipping — passam por aqui.
 *
 * `contactCountByAgent` (agente → nº de contatos cadastrados) decide se a etapa
 * Agents exige os contatos; quem não passar o mapa não exige nenhum, então uma
 * tela que não carregou contatos nunca deixa a etapa laranja por engano.
 */
export function plStepFacts(
  s: PlStepFields,
  attachments: number,
  contactCountByAgent?: Record<string, number>
): ChecklistFacts {
  const contacts = (agentId: string | null | undefined) =>
    agentId ? (contactCountByAgent?.[agentId] ?? 0) : 0;
  return {
    completedOn: s.completed_on,
    attachments,
    consolidationPointId: s.consolidation_point_id,
    cityId: s.city_id,
    polId: s.pol_id,
    carrierId: s.carrier_id,
    agentBrazilId: s.agent_brazil_id,
    agentChinaId: s.agent_china_id,
    contactBrazilId: s.contact_brazil_id,
    contactChinaId: s.contact_china_id,
    contactBrazilOptions: contacts(s.agent_brazil_id),
    contactChinaOptions: contacts(s.agent_china_id),
    bookingNumber: s.booking_number,
    eventDate: s.event_date,
  };
}

/** Texto do tooltip do ícone — "Missing: a document, a city". */
export function missingLabel(step: ChecklistStep, f: ChecklistFacts): string | undefined {
  const missing = missingForStep(step, f);
  return missing.length ? `Missing: ${missing.join(", ")}` : undefined;
}
