"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Minus, Search, TriangleAlert } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type GssRow = {
  gssId: string;
  nome: string;
  detalhe: string | null;
  /** Nome da linha nossa que carrega este `gss_id`, ou null se ninguém carrega. */
  pareadoCom: string | null;
};

export type LocalRow = {
  id: string;
  name: string;
  /** O `gss_id` gravado nesta linha, ou null se ela nunca foi pareada. */
  gssId: string | null;
};

/** Cartão de número do topo. */
function Contador({
  valor,
  rotulo,
  tom = "neutro",
}: {
  valor: number;
  rotulo: string;
  tom?: "neutro" | "bom" | "alerta";
}) {
  const cor =
    tom === "bom" ? "text-emerald-600" : tom === "alerta" ? "text-amber-600" : "text-foreground";
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className={`text-2xl font-semibold tabular-nums ${cor}`}>{valor}</div>
      <div className="text-xs text-muted-foreground">{rotulo}</div>
    </div>
  );
}

/** Normaliza para busca: sem acento, minúsculo. */
function norm(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function GssClient({
  recursoAtual,
  recursos,
  rows,
  localRows,
  detalheLabel,
  erro,
}: {
  recursoAtual: string;
  recursos: { key: string; label: string }[];
  rows: GssRow[];
  localRows: LocalRow[];
  detalheLabel?: string;
  erro: string | null;
}) {
  const router = useRouter();
  const [trocando, setTrocando] = useState(false);
  const [busca, setBusca] = useState("");

  const gssIds = useMemo(() => new Set(rows.map((r) => r.gssId)), [rows]);
  const pareadosGss = rows.filter((r) => r.pareadoCom).length;
  const semParLocal = localRows.filter((l) => !l.gssId || !gssIds.has(l.gssId)).length;

  const q = norm(busca.trim());
  const gssFiltradas = useMemo(
    () =>
      q
        ? rows.filter(
            (r) =>
              norm(r.nome).includes(q) ||
              r.gssId.includes(q) ||
              (r.detalhe ? norm(r.detalhe).includes(q) : false),
          )
        : rows,
    [rows, q],
  );
  const localFiltradas = useMemo(
    () =>
      q
        ? localRows.filter(
            (l) => norm(l.name).includes(q) || (l.gssId ? l.gssId.includes(q) : false),
          )
        : localRows,
    [localRows, q],
  );

  // Scroll sincronizado: rolar um painel rola o outro. O flag evita o eco —
  // ajustar o scrollTop do irmão dispara o onScroll dele, que é ignorado.
  const gssRef = useRef<HTMLDivElement>(null);
  const localRef = useRef<HTMLDivElement>(null);
  const sincronizando = useRef(false);

  const espelhar = useCallback(
    (origem: HTMLDivElement, alvo: HTMLDivElement | null) => {
      if (sincronizando.current) {
        sincronizando.current = false;
        return;
      }
      const top = origem.scrollTop;
      if (alvo && alvo.scrollTop !== top) {
        sincronizando.current = true;
        alvo.scrollTop = top;
      }
    },
    [],
  );

  const aoRolarGss = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => espelhar(e.currentTarget, localRef.current),
    [espelhar],
  );
  const aoRolarLocal = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => espelhar(e.currentTarget, gssRef.current),
    [espelhar],
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={recursoAtual}
          onValueChange={(v) => {
            setTrocando(true);
            router.push(`/access/gss?r=${v}`);
          }}
        >
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {recursos.map((r) => (
              <SelectItem key={r.key} value={r.key}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar nos dois lados…"
            className="h-9 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {trocando ? <span className="text-sm text-muted-foreground">carregando…</span> : null}
      </div>

      {erro ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-medium">Não consegui ler o GSS</div>
            <div className="mt-0.5 font-mono text-xs break-all">{erro}</div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Contador valor={rows.length} rotulo="registros no GSS" />
        <Contador valor={pareadosGss} rotulo="pareados aqui" tom="bom" />
        <Contador
          valor={rows.length - pareadosGss}
          rotulo="no GSS, sem par aqui"
          tom={rows.length - pareadosGss > 0 ? "alerta" : "neutro"}
        />
        <Contador
          valor={semParLocal}
          rotulo={`nossos sem par (de ${localRows.length})`}
          tom={semParLocal > 0 ? "alerta" : "neutro"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* ── Lado do GSS (origem) ── */}
        <Painel
          titulo="No GSS (origem)"
          subtitulo={`${gssFiltradas.length} de ${rows.length}`}
          scrollRef={gssRef}
          onScroll={aoRolarGss}
          vazio={
            erro
              ? "A leitura do GSS falhou — nada a mostrar deste lado."
              : "O GSS não devolveu nenhum registro."
          }
          quantidade={gssFiltradas.length}
        >
          {gssFiltradas.map((r) => (
            <li key={r.gssId} className="flex items-start gap-3 px-4 py-2.5">
              <span className="mt-0.5 shrink-0 font-mono text-xs text-muted-foreground">
                #{r.gssId}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{r.nome}</div>
                {r.detalhe ? (
                  <div className="truncate text-xs text-muted-foreground">
                    {detalheLabel ? `${detalheLabel}: ` : ""}
                    {r.detalhe}
                  </div>
                ) : null}
              </div>
              {r.pareadoCom ? (
                <span
                  title={`Pareado com "${r.pareadoCom}"`}
                  className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs text-emerald-600"
                >
                  <Check className="size-3.5" />
                  par
                </span>
              ) : (
                <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <Minus className="size-3.5" />
                  sem par
                </span>
              )}
            </li>
          ))}
        </Painel>

        {/* ── Nosso lado ── */}
        <Painel
          titulo="No nosso banco"
          subtitulo={`${localFiltradas.length} de ${localRows.length}`}
          scrollRef={localRef}
          onScroll={aoRolarLocal}
          vazio="Nenhum registro nosso para este recurso."
          quantidade={localFiltradas.length}
        >
          {localFiltradas.map((l) => {
            const pareado = !!l.gssId && gssIds.has(l.gssId);
            return (
              <li key={l.id} className="flex items-start gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{l.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {l.gssId ? (
                      <span className="font-mono">gss_id #{l.gssId}</span>
                    ) : (
                      "sem gss_id"
                    )}
                  </div>
                </div>
                {pareado ? (
                  <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs text-emerald-600">
                    <Check className="size-3.5" />
                    par
                  </span>
                ) : (
                  <span
                    title={
                      l.gssId
                        ? "Tem gss_id, mas esse id não veio no pull atual"
                        : "Nunca pareado com o GSS"
                    }
                    className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs text-amber-600"
                  >
                    <Minus className="size-3.5" />
                    sem par
                  </span>
                )}
              </li>
            );
          })}
        </Painel>
      </div>
    </div>
  );
}

/** Painel de uma coluna: cabeçalho fixo + corpo rolável (que sincroniza). */
function Painel({
  titulo,
  subtitulo,
  scrollRef,
  onScroll,
  vazio,
  quantidade,
  children,
}: {
  titulo: string;
  subtitulo: string;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  vazio: string;
  quantidade: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2.5">
        <span className="text-sm font-medium">{titulo}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{subtitulo}</span>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-[60vh] overflow-y-auto"
      >
        {quantidade === 0 ? (
          <div className="flex h-full items-center justify-center px-4 py-10 text-center text-sm text-muted-foreground">
            {vazio}
          </div>
        ) : (
          <ul className="divide-y">{children}</ul>
        )}
      </div>
    </div>
  );
}
