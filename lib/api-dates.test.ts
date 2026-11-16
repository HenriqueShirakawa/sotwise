import { describe, expect, it } from "vitest";

import { apiDay, apiInstantQuery, dayToUnix, timestampToUnix } from "./api-dates";

// Datas da API de integração em Unix (segundos), como o GSS (decisão de 06/10/2026).

const noonUtc = (day: string) => Date.parse(`${day}T12:00:00Z`) / 1000;

describe("saída", () => {
  it("DIA vira Unix às 12:00 UTC (cai no mesmo dia no Brasil e na China)", () => {
    expect(dayToUnix("2026-11-16")).toBe(noonUtc("2026-11-16"));
    const d = new Date(dayToUnix("2026-11-16")! * 1000);
    expect(d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })).toBe("2026-11-16");
    expect(d.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" })).toBe("2026-11-16");
  });

  it("MOMENTO vira Unix com fração de milissegundos", () => {
    expect(timestampToUnix("2026-11-16T12:00:00.250Z")).toBe(noonUtc("2026-11-16") + 0.25);
  });

  it("vazio ou inválido vira null", () => {
    expect(dayToUnix(null)).toBeNull();
    expect(dayToUnix("lixo")).toBeNull();
    expect(timestampToUnix(undefined)).toBeNull();
  });
});

describe("apiDay (entrada de DIA)", () => {
  it("aceita Unix em segundos e devolve o dia UTC", () => {
    expect(apiDay.parse(noonUtc("2026-11-16"))).toBe("2026-11-16");
  });

  it("aceita o formato antigo YYYY-MM-DD", () => {
    expect(apiDay.parse("2026-11-16")).toBe("2026-11-16");
  });

  it("recusa milissegundos (erro comum de integração) e texto fora do formato", () => {
    expect(apiDay.safeParse(noonUtc("2026-11-16") * 1000).success).toBe(false);
    expect(apiDay.safeParse("16/11/2026").success).toBe(false);
  });
});

describe("apiInstantQuery (updated_since)", () => {
  it("Unix em segundos vira ISO", () => {
    expect(apiInstantQuery.parse("1700000000")).toBe("2023-11-14T22:13:20.000Z");
  });

  it("ISO 8601 com fuso passa como está", () => {
    expect(apiInstantQuery.parse("2026-11-16T10:00:00-03:00")).toBe("2026-11-16T10:00:00-03:00");
  });

  it("recusa milissegundos, ISO sem fuso e vazio", () => {
    expect(apiInstantQuery.safeParse("1700000000000").success).toBe(false);
    expect(apiInstantQuery.safeParse("2026-11-16T10:00:00").success).toBe(false);
    expect(apiInstantQuery.safeParse("  ").success).toBe(false);
  });
});
