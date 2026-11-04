/**
 * Regra dos limites da SIA, compartilhada entre a tela /access/sia e as actions
 * (03/11/2026, pedido do usuário): o limite do DIA não pode passar o do MÊS —
 * 500 por dia com 200 no mês não faz sentido. Vale sobre o limite EFETIVO
 * (o do usuário, ou o padrão onde ele deixou vazio). `null` = sem limite, e
 * aí não há o que comparar.
 */
export type LimitPair = { daily: number | null; monthly: number | null };

export function effectivePair(fallback: LimitPair, own: LimitPair): LimitPair {
  return { daily: own.daily ?? fallback.daily, monthly: own.monthly ?? fallback.monthly };
}

export function dailyAboveMonthly(l: LimitPair): boolean {
  return l.daily !== null && l.monthly !== null && l.daily > l.monthly;
}

const fmt = (n: number) => n.toLocaleString("pt-BR");

export function dailyAboveMonthlyMessage(l: LimitPair): string {
  return `O limite por dia (${fmt(l.daily ?? 0)}) não pode ser maior que o do mês (${fmt(l.monthly ?? 0)}).`;
}
