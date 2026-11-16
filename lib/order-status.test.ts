import { describe, expect, it, vi } from "vitest";

import type { BatchStatus, OrderStatus } from "@/types/database";

// O módulo também grava no banco e avisa GSS/realtime/clientes; aqui só
// interessa a regra pura, então os efeitos colaterais viram stubs.
vi.mock("@/domain/client/notifications", () => ({ scheduleClientNotificationDispatch: vi.fn() }));
vi.mock("@/lib/checklist-revisions", () => ({ syncOrderPreLoadingStep: vi.fn() }));
vi.mock("@/lib/gss/outbound/schedule", () => ({ sendOrderStatusToGss: vi.fn() }));
vi.mock("@/lib/orders-realtime", () => ({ broadcastOrderStatusPing: vi.fn() }));

const { rollupOrderStatus } = await import("./order-status");

/**
 * Status da Order = rollup dos lotes (docs/regras_de_negocio.md §3.7.1, planilha
 * "StatusSOT"). Lê da fase mais adiantada para a mais atrasada.
 */
describe("rollupOrderStatus", () => {
  const roll = (batches: BatchStatus[], current: OrderStatus = "in_production") =>
    rollupOrderStatus(batches, current);

  it.each<[BatchStatus[], OrderStatus]>([
    [["in_negotiation", "in_negotiation"], "in_negotiation"],
    [["in_production", "in_production"], "in_production"],
    [["preloading", "preloading"], "pre_loading"],
    [["in_transit", "in_transit"], "shipped"],
    [["delivered", "delivered"], "delivered"],
  ])("todos os lotes iguais %j → %s", (batches, expected) => {
    expect(roll(batches)).toBe(expected);
  });

  it.each<[BatchStatus[], OrderStatus]>([
    [["delivered", "in_production"], "partially_delivered"],
    [["delivered", "in_transit"], "partially_delivered"],
    [["in_transit", "preloading"], "partially_shipped"],
    [["in_transit", "in_negotiation"], "partially_shipped"],
  ])("fase mais adiantada decide quando nem todos chegaram nela: %j → %s", (batches, expected) => {
    expect(roll(batches)).toBe(expected);
  });

  it("lote em pré-carga com outros atrás conta como produção (sem Partially Preloading desde 26/10)", () => {
    expect(roll(["preloading", "in_production"])).toBe("in_production");
    expect(roll(["preloading", "in_negotiation"])).toBe("in_production");
  });

  it("lote novo em negociação não regride uma Order que já tem lote adiante", () => {
    expect(roll(["in_production", "in_negotiation"], "in_production")).toBe("in_production");
  });

  it("lotes cancelados não participam do rollup", () => {
    expect(roll(["delivered", "canceled"])).toBe("delivered");
    expect(roll(["in_transit", "canceled", "in_transit"])).toBe("shipped");
  });

  it("sem lote ativo, a Order mantém o status que tem", () => {
    expect(roll([], "in_negotiation")).toBe("in_negotiation");
    expect(roll(["canceled", "canceled"], "shipped")).toBe("shipped");
  });

  it("Order cancelada nunca é \"descancelada\" pelo rollup", () => {
    expect(roll(["delivered", "delivered"], "canceled")).toBe("canceled");
  });
});
