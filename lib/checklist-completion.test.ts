import { describe, expect, it } from "vitest";

import {
  LOCKED_COMPLETED_ON_STEPS,
  TRIGGER_COMPLETED_STEPS,
  allBatchesInPreLoading,
  autoCompleteFill,
  autoCompleteFillChanges,
  hasExtraRequirements,
  isAutoCompleteStep,
  isReadyToShip,
  isStepChecked,
  missingForStep,
  missingLabel,
  plStepFacts,
  requiresStepPlan,
  validateStepDates,
  type ChecklistFacts,
} from "./checklist-completion";

/**
 * Regra do "Checked" (verde) das 24 etapas — a mesma nas telas de Order,
 * Pre-loading e Shipment. Datas de corte relevantes: cut-offs do Booking e
 * regra por cliente desde 22/10/2026; Estimated + Responsible desde 26/10/2026.
 */

const DONE = "2026-11-10"; // concluída depois de todas as datas de corte
const OLD = "2026-10-01"; // concluída antes de todas elas

const facts = (f: Partial<ChecklistFacts> = {}): ChecklistFacts => ({ completedOn: DONE, ...f });

describe("allBatchesInPreLoading (etapa Pre-Loading da Order)", () => {
  it("exige todos os lotes ativos em Pre-Loading ou adiante", () => {
    expect(allBatchesInPreLoading(["preloading", "in_transit", "delivered"])).toBe(true);
    expect(allBatchesInPreLoading(["preloading", "in_production"])).toBe(false);
  });

  it("ignora cancelados, mas Order sem lote ativo não cumpre", () => {
    expect(allBatchesInPreLoading(["preloading", "canceled"])).toBe(true);
    expect(allBatchesInPreLoading(["canceled"])).toBe(false);
    expect(allBatchesInPreLoading([])).toBe(false);
  });
});

describe("base comum: Completed on", () => {
  it("sem Completed on nenhuma etapa fica verde", () => {
    expect(missingForStep("order", { completedOn: null })).toEqual(["a completion date"]);
    expect(isStepChecked("order", { completedOn: null })).toBe(false);
  });

  it("etapa sem exigência extra fecha só com a data", () => {
    expect(isStepChecked("order", facts())).toBe(true);
    expect(hasExtraRequirements("order")).toBe(false);
  });
});

describe("Estimated date + Responsible", () => {
  it("só a Loading Date exige os dois; nas outras, concluir preenche o que falta", () => {
    expect(requiresStepPlan("loading_date")).toBe(true);
    expect(requiresStepPlan("booking")).toBe(false);
    expect(missingForStep("loading_date", facts({ estimatedDate: null, responsibleId: null }))).toEqual([
      "an estimated date",
      "a responsible",
    ]);
    expect(isStepChecked("order", facts({ estimatedDate: null, responsibleId: null }))).toBe(true);
  });

  it("undefined (tela não carregou a coluna) não julga; só null (carregado e vazio) falta", () => {
    expect(isStepChecked("loading_date", facts())).toBe(true);
  });

  it("etapa concluída antes de 26/10/2026 segue concluída", () => {
    expect(isStepChecked("loading_date", facts({ completedOn: OLD, estimatedDate: null, responsibleId: null }))).toBe(
      true
    );
  });
});

describe("exigências da fase Order", () => {
  it("PO precisa de Factory × Category", () => {
    expect(missingForStep("po", facts())).toEqual(["Factory × Category entries"]);
    expect(isStepChecked("po", facts({ factoryCategoryCount: 2 }))).toBe(true);
  });

  it("Place the Order precisa de \"Placed on\" em TODAS as fábricas", () => {
    expect(missingForStep("place_the_order", facts({ placeOrderFactoriesTotal: 3, placeOrderFactoriesDated: 2 }))).toEqual([
      "a placed-on date for every factory (2/3)",
    ]);
    expect(missingForStep("place_the_order", facts())).toEqual(["a placed-on date for every factory (0/0)"]);
    expect(isStepChecked("place_the_order", facts({ placeOrderFactoriesTotal: 3, placeOrderFactoriesDated: 3 }))).toBe(
      true
    );
  });

  it("ETD precisa da Initial date em todas as entradas; Pre-Loading, de todos os lotes em PL", () => {
    expect(isStepChecked("etd", facts())).toBe(false);
    expect(isStepChecked("etd", facts({ etdInitialFilled: true }))).toBe(true);
    expect(isStepChecked("pre_loading", facts())).toBe(false);
    expect(isStepChecked("pre_loading", facts({ batchesInPreLoading: true }))).toBe(true);
  });
});

describe("exigências da fase Pre-loading", () => {
  it("Consolidation Point fecha com o ponto E a cidade", () => {
    expect(missingForStep("consolidation_point", facts())).toEqual(["a consolidation point", "a city"]);
    expect(isStepChecked("consolidation_point", facts({ consolidationPointId: "f1", cityId: "c1" }))).toBe(true);
  });

  it("Agents exige contato só quando o agente escolhido tem contato cadastrado", () => {
    const base = facts({ carrierId: "car", agentBrazilId: "br", agentChinaId: "cn" });
    expect(isStepChecked("agents", base)).toBe(true);
    expect(missingForStep("agents", { ...base, contactBrazilOptions: 2, contactChinaOptions: 0 })).toEqual([
      "a contact Brazil",
    ]);
    expect(isStepChecked("agents", { ...base, contactBrazilOptions: 2, contactBrazilId: "p1" })).toBe(true);
  });

  it("Booking exige número (sem espaços em branco) e os dois cut-offs", () => {
    expect(missingForStep("booking", facts({ bookingNumber: "  " }))).toEqual([
      "the booking number",
      "the container cut-off",
      "the doc cut-off",
    ]);
    expect(
      isStepChecked("booking", facts({ bookingNumber: "BK1", containerCutoff: "2026-11-01", docCutoff: "2026-10-30" }))
    ).toBe(true);
  });

  it("Booking concluído antes de 22/10/2026 não exige os cut-offs", () => {
    expect(isStepChecked("booking", facts({ completedOn: OLD, bookingNumber: "BK1" }))).toBe(true);
  });

  it("Shipping Docs: um documento no PL, ou um POR cliente quando o PL tem 2+ clientes", () => {
    expect(missingForStep("shipping_docs", facts())).toEqual(["a document"]);
    expect(isStepChecked("shipping_docs", facts({ attachments: 1 }))).toBe(true);
    expect(isStepChecked("shipping_docs", facts({ attachments: 1, perClient: { total: 1, withDoc: 0 } }))).toBe(true);
    expect(missingForStep("shipping_docs", facts({ attachments: 5, perClient: { total: 3, withDoc: 2 } }))).toEqual([
      "a document for every client (2/3)",
    ]);
  });
});

describe("exigências da fase Shipment", () => {
  it("BL por cliente desde 22/10/2026; antes disso, um documento no PL basta", () => {
    const perClient = { total: 2, withDoc: 2, withBlDoc: 1 };
    expect(missingForStep("bl", facts({ attachments: 1, perClient }))).toEqual(["a document for every client (1/2)"]);
    expect(isStepChecked("bl", facts({ completedOn: OLD, attachments: 1, perClient }))).toBe(true);
  });

  it("Original Docs vale por cliente mesmo com 1 cliente (documento + tracking ou telex)", () => {
    expect(
      missingForStep("original_docs", facts({ attachments: 1, perClient: { total: 1, withDoc: 1, withOriginalDocs: 0 } }))
    ).toEqual(["a document and a tracking number or telex release for every client (0/1)"]);
    expect(isStepChecked("original_docs", facts({ perClient: { total: 1, withDoc: 1, withOriginalDocs: 1 } }))).toBe(
      true
    );
  });

  it("datas do fato fecham com a data informada", () => {
    expect(missingForStep("eta_brazil", facts())).toEqual(["the eta"]);
    expect(missingForStep("shipping_date", facts())).toEqual(["the shipping date"]);
    expect(isStepChecked("ata_brazil", facts({ eventDate: "2026-11-01" }))).toBe(true);
  });

  it("Delivered: uma data por cliente no PL com 2+ clientes", () => {
    expect(missingForStep("delivered", facts())).toEqual(["the delivered date"]);
    expect(
      missingForStep("delivered", facts({ eventDate: "2026-11-01", perClient: { total: 2, withDoc: 0, withDelivered: 1 } }))
    ).toEqual(["a delivered date for every client (1/2)"]);
  });
});

describe("auto complete", () => {
  it("toda etapa travada é de auto complete, menos a Loading Date", () => {
    expect(isAutoCompleteStep("booking")).toBe(true);
    expect(isAutoCompleteStep("loading_date")).toBe(false);
    for (const step of TRIGGER_COMPLETED_STEPS) expect(LOCKED_COMPLETED_ON_STEPS.has(step)).toBe(true);
  });

  it("preenche só o que está em branco: Estimated = Completed on, Responsible = quem concluiu", () => {
    const empty = { estimated_date: null, responsible_id: null };
    expect(autoCompleteFill("booking", empty, DONE, "u1")).toEqual({ estimated_date: DONE, responsible_id: "u1" });
    expect(autoCompleteFill("booking", { estimated_date: "2026-11-01", responsible_id: "u0" }, DONE, "u1")).toEqual({});
  });

  it("conclusão vinda do GSS (sem usuário) deixa o Responsible em branco", () => {
    expect(autoCompleteFill("po", { estimated_date: null, responsible_id: null }, DONE, null)).toEqual({
      estimated_date: DONE,
    });
  });

  it("Loading Date não é preenchida (o popup do Confirm pede os dois)", () => {
    expect(autoCompleteFill("loading_date", { estimated_date: null, responsible_id: null }, DONE, "u1")).toEqual({});
  });

  it("autoCompleteFillChanges vira o formato do History", () => {
    expect(autoCompleteFillChanges({ estimated_date: DONE })).toEqual({ estimated_date: { from: null, to: DONE } });
  });
});

describe("isReadyToShip (trava do Confirm Shipping)", () => {
  it("Loading Date libera com Estimated date + Responsible, mesmo sem Completed on", () => {
    expect(isReadyToShip("loading_date", { completedOn: null }, "2026-11-20")).toBe(true);
    expect(isReadyToShip("loading_date", { completedOn: null, responsibleId: null }, "2026-11-20")).toBe(false);
    expect(isReadyToShip("loading_date", { completedOn: null }, null)).toBe(false);
  });

  it("as outras etapas precisam estar Checked", () => {
    expect(isReadyToShip("booking", facts({ bookingNumber: "BK" }), null)).toBe(false);
  });
});

describe("validateStepDates", () => {
  const today = "2026-11-16";

  it("Completed on nunca pode ser futuro", () => {
    expect(validateStepDates({ estimated_date: null, completed_on: null }, { completed_on: "2026-11-17" }, "city", today)).toBe(
      "The completion date can't be in the future."
    );
    expect(validateStepDates({ estimated_date: null, completed_on: null }, { completed_on: today }, "city", today)).toBeNull();
  });

  it("etapa concluída não deixa apagar Estimated date nem Responsible", () => {
    const current = { estimated_date: "2026-11-01", completed_on: "2026-11-02", responsible_id: "u1" };
    expect(validateStepDates(current, { estimated_date: null }, "city", today)).toMatch(/estimated date can't be cleared/);
    expect(validateStepDates(current, { responsible_id: null }, "city", today)).toMatch(/responsible can't be cleared/);
    expect(validateStepDates(current, { estimated_date: "2026-11-05" }, "city", today)).toBeNull();
  });

  it("limpar o Completed on junto libera (e editar campo antigo não é barrado)", () => {
    const current = { estimated_date: "2026-11-01", completed_on: "2026-11-02", responsible_id: "u1" };
    expect(validateStepDates(current, { completed_on: null, estimated_date: null }, "city", today)).toBeNull();
    expect(validateStepDates({ estimated_date: null, completed_on: "2025-01-01" }, {}, "city", today)).toBeNull();
  });
});

describe("plStepFacts + missingLabel", () => {
  it("mapeia a linha do PL e conta os contatos do agente escolhido", () => {
    const f = plStepFacts(
      { completed_on: DONE, carrier_id: "car", agent_brazil_id: "br", agent_china_id: "cn", booking_number: "BK" },
      0,
      { br: 3 }
    );
    expect(f.contactBrazilOptions).toBe(3);
    expect(f.contactChinaOptions).toBe(0);
    expect(missingLabel("agents", f)).toBe("Missing: a contact Brazil");
  });

  it("sem mapa de contatos, a etapa Agents não exige contato", () => {
    const f = plStepFacts({ completed_on: DONE, carrier_id: "car", agent_brazil_id: "br", agent_china_id: "cn" }, 0);
    expect(missingLabel("agents", f)).toBeUndefined();
  });
});
