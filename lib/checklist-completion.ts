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
  /** Place the Order: fábricas distintas do pedido (agrupamento da etapa). */
  placeOrderFactoriesTotal?: number;
  /** Place the Order: quantas dessas fábricas já têm ao menos um documento. */
  placeOrderFactoriesWithDoc?: number;
  /** ETD: "Initial date" preenchido em TODAS as entradas Factory × Category. */
  etdInitialFilled?: boolean;
  /** PI: só pedido do tipo Sales exige o documento (ver `piDocumentRequired`). */
  piDocumentRequired?: boolean;

  // ── fase Pre-loading ──────────────────────────────────────────────────────
  consolidationPointId?: string | null;
  cityId?: string | null;
  polId?: string | null;
  carrierAgentId?: string | null;
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
};

/**
 * PI exige documento? Só no tipo **Sales** — Samples, Gift e Replacement
 * concluem a etapa só com a data. Tipo desconhecido (ou pedido sem tipo) não
 * exige, para não travar etapa por dado que a tela nem tem.
 */
export function piDocumentRequired(orderTypeName: string | null | undefined): boolean {
  return /sale/i.test(orderTypeName ?? "");
}

/** Condições ALÉM do "Completed on", em rótulos prontos pra UI. */
function missingExtras(step: ChecklistStep, f: ChecklistFacts): string[] {
  const missing: string[] = [];
  const noDocs = (f.attachments ?? 0) === 0;

  switch (step) {
    case "po":
      if (noDocs) missing.push("a document");
      if ((f.factoryCategoryCount ?? 0) === 0) missing.push("Factory × Category entries");
      break;
    case "pi":
      if (f.piDocumentRequired && noDocs) missing.push("a document");
      break;
    case "place_the_order": {
      // Não basta UM documento na etapa: CADA fábrica do agrupamento precisa do
      // seu. A etapa só fecha quando todas têm ao menos um doc anexado.
      const total = f.placeOrderFactoriesTotal ?? 0;
      const withDoc = f.placeOrderFactoriesWithDoc ?? 0;
      if (total === 0) missing.push("a document for every factory");
      else if (withDoc < total)
        missing.push(`a document for every factory (${withDoc}/${total})`);
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
      if (!f.carrierAgentId) missing.push("a carrier agent");
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

    // Inspection Report aceita documento, mas hoje ele é OPCIONAL — a etapa
    // fecha só com a data (pode virar obrigatório mais pra frente).
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
export function hasExtraRequirements(step: ChecklistStep, f: ChecklistFacts): boolean {
  return (
    missingExtras(step, {
      completedOn: null,
      piDocumentRequired: f.piDocumentRequired,
    }).length > 0
  );
}

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
  patch: { estimated_date?: string | null; completed_on?: string | null }
): string | null {
  const touchesEstimated = "estimated_date" in patch;
  const touchesCompleted = "completed_on" in patch;
  if (!touchesEstimated && !touchesCompleted) return null;

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
  carrier_agent_id?: string | null;
  agent_brazil_id?: string | null;
  agent_china_id?: string | null;
  contact_brazil_id?: string | null;
  contact_china_id?: string | null;
  booking_number?: string | null;
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
    carrierAgentId: s.carrier_agent_id,
    agentBrazilId: s.agent_brazil_id,
    agentChinaId: s.agent_china_id,
    contactBrazilId: s.contact_brazil_id,
    contactChinaId: s.contact_china_id,
    contactBrazilOptions: contacts(s.agent_brazil_id),
    contactChinaOptions: contacts(s.agent_china_id),
    bookingNumber: s.booking_number,
  };
}

/** Texto do tooltip do ícone — "Missing: a document, a city". */
export function missingLabel(step: ChecklistStep, f: ChecklistFacts): string | undefined {
  const missing = missingForStep(step, f);
  return missing.length ? `Missing: ${missing.join(", ")}` : undefined;
}
