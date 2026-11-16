import { describe, expect, it, vi } from "vitest";

// Só os montadores de payload interessam aqui — nada sai para o GSS.
vi.mock("../client", () => ({ gssRequest: vi.fn() }));

const { createBody, createStatus, datesBody, headerBody, metaBody, numericPlNumber } = await import("./pl-shipment");
type PlShipmentState = import("./pl-shipment").PlShipmentState;

const noonUtc = (day: string) => Date.parse(`${day}T12:00:00Z`) / 1000;

const state = (over: Partial<PlShipmentState> = {}): PlShipmentState => ({
  preLoadingId: "pl-uuid",
  plNumber: 1519,
  clientReference: null,
  podGssId: null,
  shipmentStatus: null,
  completedOn: {
    loading_date: "2026-11-01",
    shipping_date: null,
    bl: null,
    eta_brazil: null,
    ata_brazil: null,
    delivered: null,
  },
  ...over,
});

describe("numericPlNumber", () => {
  it("extrai o número do fim de \"PL - 1354\"", () => {
    expect(numericPlNumber("PL - 1354")).toBe(1354);
    expect(numericPlNumber("1354")).toBe(1354);
    expect(numericPlNumber("PL sem número")).toBeNull();
  });
});

describe("createStatus", () => {
  it("sem embarque = preloading; depois, o status do embarque; cancelado não manda", () => {
    expect(createStatus(null)).toBe("preloading");
    expect(createStatus("in_transit")).toBe("in_transit");
    expect(createStatus("delivered")).toBe("delivered");
    expect(createStatus("canceled")).toBeNull();
  });
});

describe("datesBody", () => {
  it("manda as 6 datas em Unix com os nomes do GSS; etapa sem data vai null (limpa lá)", () => {
    expect(datesBody(state())).toEqual({
      loading_date: noonUtc("2026-11-01"),
      shipping_date: null,
      bl_date: null,
      eta_destination: null,
      ata_destination: null,
      delivered_date: null,
    });
  });
});

describe("metaBody", () => {
  it("manda status + lotes; lista de lotes ausente ou vazia não vai (não apaga vínculo do GSS)", () => {
    expect(metaBody(state({ batchGssIds: [10, 11] }))).toEqual({ status: "preloading", batch_ids: [10, 11] });
    expect(metaBody(state({ batchGssIds: [] }))).toEqual({ status: "preloading" });
    expect(metaBody(state({ shipmentStatus: "canceled" }))).toEqual({});
  });
});

describe("createBody", () => {
  it("monta a criação com referência do cliente (trim, até 100) e POD quando existe", () => {
    const body = createBody(state({ clientReference: `  ${"R".repeat(150)}  `, podGssId: 7 }), "preloading");
    expect(body.pl_number).toBe(1519);
    expect(body.status).toBe("preloading");
    expect(body.customer_reference).toBe("R".repeat(100));
    expect(body.pod).toBe(7);
  });

  it("referência em branco e POD sem vínculo ficam de fora", () => {
    const body = createBody(state({ clientReference: "   " }), "preloading");
    expect(body).not.toHaveProperty("customer_reference");
    expect(body).not.toHaveProperty("pod");
  });
});

describe("headerBody", () => {
  it("só manda o que tem gss_id/valor; a cidade vai em city E cons_point", () => {
    const body = headerBody(
      state({
        header: {
          polGssId: 3,
          cityGssId: 9,
          carrierGssId: null,
          originAgentGssId: 4,
          destinationAgentGssId: null,
          leaderEmail: "leader@example.com",
          signerEmail: null,
        },
      })
    );
    expect(body).toEqual({ pol: 3, city: 9, cons_point: 9, origin_agent: 4, leader_email: "leader@example.com" });
  });

  it("sem cabeçalho, só referência/POD", () => {
    expect(headerBody(state({ podGssId: 2 }))).toEqual({ pod: 2 });
    expect(headerBody(state())).toEqual({});
  });
});
