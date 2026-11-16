import { describe, expect, it, vi } from "vitest";

// O "hoje" do usuário lê cookie do Next; nos testes a data vai explícita.
vi.mock("@/lib/user-time-zone", () => ({ userTodayIso: async () => "2026-11-16" }));

const { ETD_POPUP_KEY, buildEtdNotifications, ordersInScope, popupDueToday } = await import("./etd-notifications");
type OverdueLine = import("./etd-notifications").OverdueLine;

// Sino "ETD vencendo" (docs/regras_de_negocio.md §3.7.4): Initial Date atrasada
// e sem Ready parts = notificação, uma por Order por dia.

const TODAY = "2026-11-16";
const line = (over: Partial<OverdueLine> = {}): OverdueLine => ({
  order_id: "o1",
  po_number: "1741",
  client: "ACME",
  factory: "518",
  initial_date: "2026-11-13",
  ...over,
});

describe("ordersInScope (quem recebe)", () => {
  const steps = [
    { order_id: "o1", responsible_id: "henrique" },
    { order_id: "o2", responsible_id: "anna" },
    { order_id: "o3", responsible_id: null },
  ];

  it("user comum recebe só as Orders em que é o Responsible da etapa ETD", () => {
    expect([...ordersInScope(steps, "henrique", false)]).toEqual(["o1"]);
    expect([...ordersInScope(steps, "ida", false)]).toEqual([]);
  });

  it("admin recebe todas as atrasadas, inclusive Order sem Responsible", () => {
    expect([...ordersInScope(steps, "henrique", true)]).toEqual(["o1", "o2", "o3"]);
  });
});

describe("buildEtdNotifications", () => {
  it("agrupa as linhas por Order, com as fábricas e a Initial Date mais antiga", () => {
    const [n] = buildEtdNotifications({
      lines: [line(), line({ factory: "AGK", initial_date: "2026-11-10" }), line({ factory: "518" })],
      today: TODAY,
      readKeys: new Set(),
    });
    expect(n).toMatchObject({
      key: `o1:${TODAY}`,
      poNumber: "1741",
      lines: 3,
      factories: ["518", "AGK"],
      earliestInitialDate: "2026-11-10",
      daysOverdue: 6,
      read: false,
      responsible: null,
    });
    expect(n.href).toBe(`/etd-factories?q=1741&initial_to=${TODAY}&ready_parts=no`);
  });

  it("dispara no próprio dia da Initial Date (0 dias) e ignora data futura", () => {
    const out = buildEtdNotifications({
      lines: [line({ initial_date: TODAY }), line({ order_id: "o2", po_number: "1800", initial_date: "2026-11-17" })],
      today: TODAY,
      readKeys: new Set(),
    });
    expect(out.map((n) => [n.poNumber, n.daysOverdue])).toEqual([["1741", 0]]);
  });

  it("a chave muda todo dia: lida ontem volta como não lida hoje", () => {
    const lines = [line()];
    expect(buildEtdNotifications({ lines, today: TODAY, readKeys: new Set([`o1:${TODAY}`]) })[0].read).toBe(true);
    expect(buildEtdNotifications({ lines, today: TODAY, readKeys: new Set(["o1:2026-11-15"]) })[0].read).toBe(false);
  });

  it("ordena da mais atrasada para a menos; empate pelo número da PO", () => {
    const out = buildEtdNotifications({
      lines: [
        line({ order_id: "a", po_number: "900", initial_date: "2026-11-15" }),
        line({ order_id: "b", po_number: "1000", initial_date: "2026-11-01" }),
        line({ order_id: "c", po_number: "80", initial_date: "2026-11-15" }),
      ],
      today: TODAY,
      readKeys: new Set(),
    });
    expect(out.map((n) => n.poNumber)).toEqual(["1000", "80", "900"]);
  });

  it("visão de admin traz o Responsible de cada Order (ou null)", () => {
    const out = buildEtdNotifications({
      lines: [line(), line({ order_id: "o2", po_number: "1800" })],
      today: TODAY,
      readKeys: new Set(),
      responsibleByOrder: new Map([
        ["o1", "Henrique Shirakawa"],
        ["o2", null],
      ]),
    });
    expect(out.map((n) => n.responsible)).toEqual(["Henrique Shirakawa", null]);
  });
});

describe("popupDueToday (popup uma vez por dia)", () => {
  it("abre quando ainda não foi mostrado hoje", () => {
    expect(popupDueToday({}, TODAY)).toBe(true);
    expect(popupDueToday(null, TODAY)).toBe(true);
    expect(popupDueToday({ [ETD_POPUP_KEY]: "2026-11-15" }, TODAY)).toBe(true);
  });

  it("não abre de novo no mesmo dia", () => {
    expect(popupDueToday({ [ETD_POPUP_KEY]: TODAY }, TODAY)).toBe(false);
  });
});
