"use client";

import { useMemo, useState, useTransition } from "react";
import { Loader2, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  BRL_PER_USD,
  COPILOT_PRICE_PER_MILLION,
  COPILOT_TYPICAL_PER_10K,
} from "@/lib/copilot/pricing";
import { dailyAboveMonthly, dailyAboveMonthlyMessage, effectivePair } from "@/lib/copilot/limit-rules";

import { setDefaultLimits, setUserLimits } from "./actions";

export type SiaUserRow = {
  id: string;
  name: string;
  role: string;
  active: boolean;
  /** Limite próprio; null = herda do padrão. */
  daily: number | null;
  monthly: number | null;
  dayUsed: number;
  monthUsed: number;
};

type Limits = { daily: number | null; monthly: number | null };

const fmt = (n: number) => n.toLocaleString("pt-BR");

/** Campo → número: vazio = null; aceita "200.000" ou "200 000". undefined = inválido. */
function parseTokens(raw: string): number | null | undefined {
  const clean = raw.replace(/[.\s_]/g, "").trim();
  if (clean === "") return null;
  if (!/^\d+$/.test(clean)) return undefined;
  const n = Number(clean);
  return Number.isSafeInteger(n) ? n : undefined;
}

const toField = (n: number | null) => (n === null ? "" : fmt(n));

/** Dia acima do mês com o que está digitado (o servidor confere de novo). */
function pairError(fallback: Limits, daily: string, monthly: string): string | null {
  const d = parseTokens(daily);
  const m = parseTokens(monthly);
  if (d === undefined || m === undefined) return null;
  const pair = effectivePair(fallback, { daily: d, monthly: m });
  return dailyAboveMonthly(pair) ? dailyAboveMonthlyMessage(pair) : null;
}

function Usage({ used, limit }: { used: number; limit: number | null }) {
  const pct = limit === null ? 0 : limit === 0 ? 100 : Math.min(100, (used / limit) * 100);
  const bar = pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-primary";
  return (
    <div className="min-w-32">
      <div className="text-xs tabular-nums">
        <span className="font-medium">{fmt(used)}</span>
        <span className="text-muted-foreground"> / {limit === null ? "sem limite" : fmt(limit)}</span>
      </div>
      {limit !== null && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

const usd = (n: number) =>
  `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
const brl = (n: number) =>
  `R$ ${(n * BRL_PER_USD).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: n * BRL_PER_USD < 0.01 ? 4 : 2 })}`;

const PRICE_ROWS = [
  { label: "Entrada (pergunta + dados lidos)", perMillion: COPILOT_PRICE_PER_MILLION.input },
  { label: "Saída (texto que a SIA escreve)", perMillion: COPILOT_PRICE_PER_MILLION.output },
  { label: "Lido do cache", perMillion: COPILOT_PRICE_PER_MILLION.cacheRead },
  { label: "Gravado no cache", perMillion: COPILOT_PRICE_PER_MILLION.cacheWrite },
];

/** Quanto os tokens valem em dinheiro — referência para definir os limites. */
function PricingCard({ defaults }: { defaults: Limits }) {
  const worst = (tokens: number) => (tokens / 1_000_000) * COPILOT_PRICE_PER_MILLION.output;
  const typical = { min: COPILOT_TYPICAL_PER_10K.min / 10_000, max: COPILOT_TYPICAL_PER_10K.max / 10_000 };
  const limitLine = (label: string, tokens: number | null) =>
    tokens === null ? (
      <li>{label}: sem limite</li>
    ) : (
      <li>
        {label} ({fmt(tokens)} tokens): uso normal {usd(tokens * typical.min)} a {usd(tokens * typical.max)} · pior
        caso {usd(worst(tokens))} ({brl(worst(tokens))})
      </li>
    );

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-sm font-medium">Quanto custa</div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Preço de tabela da Anthropic para o modelo da SIA (Claude Haiku 5.5). Reais com o dólar a{" "}
        {brl(1)}, só de referência.
      </p>
      <div className="mt-3 overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Tipo de token</th>
              <th className="px-3 py-2 text-right font-medium">Por milhão</th>
              <th className="px-3 py-2 text-right font-medium">10 mil tokens</th>
              <th className="px-3 py-2 text-right font-medium">10 mil tokens (R$)</th>
            </tr>
          </thead>
          <tbody>
            {PRICE_ROWS.map((r) => (
              <tr key={r.label} className="border-t">
                <td className="px-3 py-2">{r.label}</td>
                <td className="px-3 py-2 text-right tabular-nums">{usd(r.perMillion)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{usd(r.perMillion / 100)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{brl(r.perMillion / 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
        <li>
          Na prática, uma pergunta gasta uns 7.500 tokens, quase tudo entrada e cache: 10 mil tokens saem por{" "}
          {usd(COPILOT_TYPICAL_PER_10K.min)} a {usd(COPILOT_TYPICAL_PER_10K.max)} (
          {brl(COPILOT_TYPICAL_PER_10K.min)} a {brl(COPILOT_TYPICAL_PER_10K.max)}).
        </li>
        {limitLine("Limite padrão por dia, por usuário", defaults.daily)}
        {limitLine("Limite padrão por mês, por usuário", defaults.monthly)}
        <li>Vale para pergunta de até 100 mil tokens (sempre o caso da SIA); acima disso o preço sobe 5 vezes. O valor exato está na fatura do console da Anthropic.</li>
      </ul>
    </div>
  );
}

function DefaultsForm({ defaults }: { defaults: Limits }) {
  const [daily, setDaily] = useState(toField(defaults.daily));
  const [monthly, setMonthly] = useState(toField(defaults.monthly));
  const [pending, startTransition] = useTransition();
  const dirty = daily !== toField(defaults.daily) || monthly !== toField(defaults.monthly);
  const conflict = pairError({ daily: null, monthly: null }, daily, monthly);

  function save() {
    const d = parseTokens(daily);
    const m = parseTokens(monthly);
    if (d === undefined || m === undefined) {
      toast.error("Use um número inteiro de tokens.");
      return;
    }
    startTransition(async () => {
      const res = await setDefaultLimits(d, m);
      if (res.ok) toast.success("Limite padrão salvo.");
      else toast.error(res.error);
    });
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-sm font-medium">Limite padrão</div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Vale para todo usuário sem limite próprio. Vazio = sem limite.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-muted-foreground">
          Por dia
          <Input className="h-8 w-40" inputMode="numeric" value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="sem limite" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Por mês
          <Input className="h-8 w-40" inputMode="numeric" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="sem limite" />
        </label>
        <Button size="sm" onClick={save} disabled={!dirty || pending || conflict !== null}>
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          Salvar
        </Button>
      </div>
      {conflict && <p className="mt-2 text-xs text-red-600">{conflict}</p>}
    </div>
  );
}

function UserRow({ row, defaults }: { row: SiaUserRow; defaults: Limits }) {
  const [daily, setDaily] = useState(toField(row.daily));
  const [monthly, setMonthly] = useState(toField(row.monthly));
  const [pending, startTransition] = useTransition();
  const dirty = daily !== toField(row.daily) || monthly !== toField(row.monthly);
  const conflict = pairError(defaults, daily, monthly);

  const dayLimit = row.daily ?? defaults.daily;
  const monthLimit = row.monthly ?? defaults.monthly;
  const fallbackLabel = (n: number | null) => `padrão (${n === null ? "sem limite" : fmt(n)})`;

  function save() {
    const d = parseTokens(daily);
    const m = parseTokens(monthly);
    if (d === undefined || m === undefined) {
      toast.error("Use um número inteiro de tokens.");
      return;
    }
    startTransition(async () => {
      const res = await setUserLimits(row.id, d, m);
      if (res.ok) toast.success(`Limite de ${row.name} salvo.`);
      else toast.error(res.error);
    });
  }

  return (
    <tr className="border-t align-top">
      <td className="px-3 py-2">
        <div className="font-medium">{row.name}</div>
        <div className="text-xs text-muted-foreground">
          {row.role}
          {!row.active && " · bloqueado"}
        </div>
      </td>
      <td className="px-3 py-2">
        <Usage used={row.dayUsed} limit={dayLimit} />
      </td>
      <td className="px-3 py-2">
        <Usage used={row.monthUsed} limit={monthLimit} />
      </td>
      <td className="px-3 py-2">
        <Input className="h-8 w-40" inputMode="numeric" value={daily} onChange={(e) => setDaily(e.target.value)} placeholder={fallbackLabel(defaults.daily)} />
      </td>
      <td className="px-3 py-2">
        <Input className="h-8 w-40" inputMode="numeric" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder={fallbackLabel(defaults.monthly)} />
      </td>
      <td className="px-3 py-2 text-right">
        <Button size="sm" variant="outline" onClick={save} disabled={!dirty || pending || conflict !== null}>
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          Salvar
        </Button>
        {conflict && <p className="mt-1 text-right text-xs leading-tight text-red-600">Dia maior<br />que o mês</p>}
      </td>
    </tr>
  );
}

export function SiaClient({
  rows,
  defaults,
  loadError,
}: {
  rows: SiaUserRow[];
  defaults: Limits;
  loadError: string | null;
}) {
  const [search, setSearch] = useState("");
  const [showBlocked, setShowBlocked] = useState(false);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows
      .filter((r) => showBlocked || r.active)
      .filter((r) => !term || r.name.toLowerCase().includes(term))
      // Quem mais gastou no mês primeiro; empate em ordem alfabética.
      .sort((a, b) => b.monthUsed - a.monthUsed || a.name.localeCompare(b.name));
  }, [rows, search, showBlocked]);

  const dayTotal = rows.reduce((s, r) => s + r.dayUsed, 0);
  const monthTotal = rows.reduce((s, r) => s + r.monthUsed, 0);
  const activeUsers = rows.filter((r) => r.monthUsed > 0).length;

  return (
    <div className="space-y-4">
      {loadError && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat value={fmt(dayTotal)} label="Tokens hoje (todos)" />
        <Stat value={fmt(monthTotal)} label="Tokens no mês (todos)" />
        <Stat value={String(activeUsers)} label="Usuários que usaram a SIA no mês" />
      </div>

      <DefaultsForm key={`${defaults.daily}-${defaults.monthly}`} defaults={defaults} />

      <PricingCard defaults={defaults} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar usuário"
            className="h-8 w-64 max-w-full rounded-lg border bg-background pl-8 pr-2 text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={showBlocked} onChange={(e) => setShowBlocked(e.target.checked)} />
          Mostrar bloqueados
        </label>
        <span className="text-xs text-muted-foreground">
          Campo vazio = usa o padrão · 0 = sem acesso à SIA
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Usuário</th>
              <th className="px-3 py-2 font-medium">Hoje</th>
              <th className="px-3 py-2 font-medium">Mês</th>
              <th className="px-3 py-2 font-medium">Limite por dia</th>
              <th className="px-3 py-2 font-medium">Limite por mês</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  Nenhum usuário.
                </td>
              </tr>
            ) : (
              visible.map((r) => (
                <UserRow key={`${r.id}-${r.daily}-${r.monthly}`} row={r} defaults={defaults} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
