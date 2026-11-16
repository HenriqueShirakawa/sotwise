import { describe, expect, it } from "vitest";

import { dailyAboveMonthly, dailyAboveMonthlyMessage, effectivePair } from "./limit-rules";

// Limites de tokens da SIA (03/11/2026): o do dia não pode passar o do mês,
// comparando o limite EFETIVO (o do usuário ou, onde vazio, o padrão).

describe("effectivePair", () => {
  it("usa o do usuário onde ele preencheu e o padrão onde deixou vazio", () => {
    expect(effectivePair({ daily: 200_000, monthly: 2_000_000 }, { daily: 50_000, monthly: null })).toEqual({
      daily: 50_000,
      monthly: 2_000_000,
    });
  });
});

describe("dailyAboveMonthly", () => {
  it("barra dia maior que o mês", () => {
    expect(dailyAboveMonthly({ daily: 500, monthly: 200 })).toBe(true);
    expect(dailyAboveMonthly({ daily: 200, monthly: 200 })).toBe(false);
  });

  it("null = sem limite, não há o que comparar", () => {
    expect(dailyAboveMonthly({ daily: 500, monthly: null })).toBe(false);
    expect(dailyAboveMonthly({ daily: null, monthly: 200 })).toBe(false);
  });

  it("a regra vale sobre o efetivo: dia do usuário acima do mês padrão", () => {
    expect(dailyAboveMonthly(effectivePair({ daily: 1, monthly: 1_000 }, { daily: 5_000, monthly: null }))).toBe(true);
  });

  it("mensagem em pt-BR com os números formatados", () => {
    expect(dailyAboveMonthlyMessage({ daily: 500_000, monthly: 200_000 })).toBe(
      "O limite por dia (500.000) não pode ser maior que o do mês (200.000)."
    );
  });
});
