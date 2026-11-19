import { describe, expect, it } from "vitest";

import {
  addBatchError,
  CORRECTION_NOTHING_CHANGED,
  CORRECTION_REASON_REQUIRED,
  planShipmentCorrection,
  type CurrentShipmentState,
  type ShipmentCorrectionInput,
} from "./correction";

const TODAY = "2026-11-19";

const current: CurrentShipmentState = {
  status: "in_transit",
  header: {
    container_number: "MSCU1234567",
    seal_number: "S-1",
    loading_date: "2026-11-10",
    shipment_leader_id: "u-leader",
    preloading_leader_id: "u-pl-leader",
    carrier_id: "c-msc",
    shipment_model_id: "m-fcl",
    signer_id: "u-signer",
  },
  batches: [
    { id: "b1", status: "in_transit", label: "1700.01" },
    { id: "b2", status: "in_transit", label: "1700.02" },
  ],
};

function input(patch: Partial<ShipmentCorrectionInput> = {}): ShipmentCorrectionInput {
  return {
    container_number: "MSCU1234567",
    seal_number: "S-1",
    loading_date: "2026-11-10",
    shipment_leader_id: "u-leader",
    preloading_leader_id: "u-pl-leader",
    carrier_id: "c-msc",
    shipment_model_id: "m-fcl",
    signer_id: "u-signer",
    batch_ids: ["b1", "b2"],
    reason: "Typo in the confirm popup",
    ...patch,
  };
}

describe("planShipmentCorrection — Correct shipment", () => {
  it("exige motivo", () => {
    const r = planShipmentCorrection(current, input({ loading_date: "2026-11-08", reason: "  " }), TODAY);
    expect(r).toEqual({ ok: false, error: CORRECTION_REASON_REQUIRED });
  });

  it("sem mudança nenhuma é recusado", () => {
    expect(planShipmentCorrection(current, input(), TODAY)).toEqual({
      ok: false,
      error: CORRECTION_NOTHING_CHANGED,
    });
  });

  it("espaço nas pontas do container não conta como mudança", () => {
    const r = planShipmentCorrection(current, input({ container_number: " MSCU1234567 " }), TODAY);
    expect(r).toEqual({ ok: false, error: CORRECTION_NOTHING_CHANGED });
  });

  it("troca a Loading Date (de → para)", () => {
    const r = planShipmentCorrection(current, input({ loading_date: "2026-11-07" }), TODAY);
    expect(r.ok && r.plan.header).toEqual({
      loading_date: { from: "2026-11-10", to: "2026-11-07" },
    });
  });

  it("Loading Date futura é recusada", () => {
    const r = planShipmentCorrection(current, input({ loading_date: "2026-11-20" }), TODAY);
    expect(r).toEqual({ ok: false, error: "The loading date can't be in the future." });
  });

  it("campo obrigatório vazio é recusado", () => {
    const r = planShipmentCorrection(current, input({ carrier_id: "" }), TODAY);
    expect(r).toEqual({ ok: false, error: "Fill in all required fields." });
  });

  it("embarque legado: campo que nunca foi preenchido pode seguir vazio", () => {
    const legacy: CurrentShipmentState = {
      ...current,
      header: { ...current.header, seal_number: null, loading_date: null, shipment_model_id: null },
    };
    const r = planShipmentCorrection(
      legacy,
      input({ seal_number: "", loading_date: "", shipment_model_id: "", container_number: "COSCO 1" }),
      TODAY
    );
    expect(r.ok && r.plan.header).toEqual({
      container_number: { from: "MSCU1234567", to: "COSCO 1" },
    });
  });

  it("tira e põe lote", () => {
    const r = planShipmentCorrection(current, input({ batch_ids: ["b1", "b3"] }), TODAY);
    expect(r.ok && { added: r.plan.added, removed: r.plan.removed }).toEqual({
      added: ["b3"],
      removed: ["b2"],
    });
  });

  it("embarque não fica sem lote", () => {
    const r = planShipmentCorrection(current, input({ batch_ids: [] }), TODAY);
    expect(r).toEqual({ ok: false, error: "A shipment needs at least one batch." });
  });

  it("lote já entregue não sai do embarque", () => {
    const partly: CurrentShipmentState = {
      ...current,
      batches: [
        { id: "b1", status: "delivered", label: "1700.01" },
        { id: "b2", status: "in_transit", label: "1700.02" },
      ],
    };
    const r = planShipmentCorrection(partly, input({ batch_ids: ["b2"] }), TODAY);
    expect(r).toEqual({
      ok: false,
      error: "Only In Transit batches can leave the shipment: 1700.01.",
    });
  });

  it("embarque entregue não troca lotes, mas corrige o cabeçalho", () => {
    const done = { ...current, status: "delivered" };
    expect(planShipmentCorrection(done, input({ batch_ids: ["b1"] }), TODAY)).toEqual({
      ok: false,
      error: "A delivered shipment can't change its batches.",
    });
    const header = planShipmentCorrection(done, input({ seal_number: "S-2" }), TODAY);
    expect(header.ok).toBe(true);
  });
});

describe("addBatchError — mesma régua do Confirm", () => {
  const ok = {
    label: "1701.01",
    status: "in_production" as const,
    is_active: true,
    quantities_confirmed: true,
    pl_number: null,
  };

  it("lote livre, em produção e confirmado pelo GSS entra", () => {
    expect(addBatchError(ok)).toBeNull();
  });

  it("sem confirmação do GSS não entra", () => {
    expect(addBatchError({ ...ok, quantities_confirmed: false })).toBe(
      "Waiting for GSS to confirm the quantities of 1701.01."
    );
  });

  it("lote de outro PL não entra", () => {
    expect(addBatchError({ ...ok, pl_number: "1500" })).toBe("Batch 1701.01 is already in PL - 1500.");
  });

  it("lote fora de produção não entra", () => {
    expect(addBatchError({ ...ok, status: "in_negotiation" })).toBe(
      "Batch 1701.01 must be In Production to join the shipment."
    );
  });
});
