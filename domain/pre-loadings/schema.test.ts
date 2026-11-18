import { describe, expect, it } from "vitest";

import { PL_NEEDS_BATCH_MESSAGE, plBatchRuleError } from "./schema";

describe("plBatchRuleError — PL precisa de no mínimo 1 lote", () => {
  it("criação sem lote é recusada", () => {
    expect(plBatchRuleError([], null)).toBe(PL_NEEDS_BATCH_MESSAGE);
  });

  it("criação com lote passa", () => {
    expect(plBatchRuleError(["lote-1"], null)).toBeNull();
  });

  it("edição não deixa tirar o último lote", () => {
    expect(plBatchRuleError([], 2)).toBe(PL_NEEDS_BATCH_MESSAGE);
  });

  it("edição que mantém lote passa", () => {
    expect(plBatchRuleError(["lote-1"], 2)).toBeNull();
  });

  it("PL legado que já estava sem lote continua editável", () => {
    expect(plBatchRuleError([], 0)).toBeNull();
  });
});
