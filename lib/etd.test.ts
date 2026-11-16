import { describe, expect, it } from "vitest";

import { daysDelay, gapOfReady, isEtdLate } from "./etd";

// Campos calculados da ETD (docs/regras_de_negocio.md §3.7.4) — a tela ETD
// Factories e a SIA precisam dar o mesmo número.

describe("daysDelay", () => {
  it("conta a diferença em dias entre Initial e Current date", () => {
    expect(daysDelay("2026-11-01", "2026-11-11")).toBe(10);
  });

  it("ETD antecipada conta pelo módulo: nunca negativo", () => {
    expect(daysDelay("2026-11-11", "2026-11-01")).toBe(10);
  });

  it("sem uma das datas, ou data inválida, é desconhecido", () => {
    expect(daysDelay(null, "2026-11-01")).toBeNull();
    expect(daysDelay("2026-11-01", null)).toBeNull();
    expect(daysDelay("lixo", "2026-11-01")).toBeNull();
  });
});

describe("isEtdLate", () => {
  it("atrasada = Days Delay > 0; mesma data não é atraso; sem data é desconhecido (false)", () => {
    expect(isEtdLate("2026-11-01", "2026-11-02")).toBe(true);
    expect(isEtdLate("2026-11-01", "2026-11-01")).toBe(false);
    expect(isEtdLate(null, "2026-11-01")).toBe(false);
  });
});

describe("gapOfReady", () => {
  it("conta dias de CALENDÁRIO em São Paulo: pronto 11/11, visto 13/11 à tarde = 2", () => {
    expect(gapOfReady(true, "2026-11-11", Date.parse("2026-11-13T18:00:00Z"))).toBe(2);
  });

  it("à noite em São Paulo (já dia seguinte em UTC) ainda conta o dia de São Paulo", () => {
    // 13/11 22:00 em São Paulo = 14/11 01:00 UTC.
    expect(gapOfReady(true, "2026-11-11", Date.parse("2026-11-14T01:00:00Z"))).toBe(2);
  });

  it("sem Ready parts ou sem data não há gap", () => {
    const now = Date.parse("2026-11-13T18:00:00Z");
    expect(gapOfReady(false, "2026-11-11", now)).toBeNull();
    expect(gapOfReady(true, null, now)).toBeNull();
    expect(gapOfReady(undefined, "2026-11-11", now)).toBeNull();
  });
});
