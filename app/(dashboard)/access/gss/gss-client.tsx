"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, Minus, TriangleAlert } from "lucide-react";

import { DataTable } from "@/components/data-table";
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

export function GssClient({
  recursoAtual,
  recursos,
  rows,
  totalLocal,
  semParLocal,
  detalheLabel,
  erro,
}: {
  recursoAtual: string;
  recursos: { key: string; label: string }[];
  rows: GssRow[];
  totalLocal: number;
  semParLocal: number;
  detalheLabel?: string;
  erro: string | null;
}) {
  const router = useRouter();
  const [trocando, setTrocando] = useState(false);

  const pareados = rows.filter((r) => r.pareadoCom).length;

  const columns = useMemo<ColumnDef<GssRow>[]>(() => {
    const cols: ColumnDef<GssRow>[] = [
      {
        accessorKey: "gssId",
        header: "ID no GSS",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">#{row.original.gssId}</span>
        ),
      },
      {
        accessorKey: "nome",
        header: "Nome no GSS",
        cell: ({ row }) => <span className="font-medium">{row.original.nome}</span>,
      },
    ];
    if (detalheLabel) {
      cols.push({
        accessorKey: "detalhe",
        header: detalheLabel,
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.detalhe ?? "—"}</span>
        ),
      });
    }
    cols.push({
      accessorKey: "pareadoCom",
      header: "No nosso banco",
      cell: ({ row }) =>
        row.original.pareadoCom ? (
          <span className="inline-flex items-center gap-1.5 text-emerald-600">
            <Check className="size-4 shrink-0" />
            <span className="text-foreground">{row.original.pareadoCom}</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Minus className="size-4 shrink-0" />
            sem par
          </span>
        ),
    });
    return cols;
  }, [detalheLabel]);

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
        <Contador valor={pareados} rotulo="pareados aqui" tom="bom" />
        <Contador
          valor={rows.length - pareados}
          rotulo="no GSS, sem par aqui"
          tom={rows.length - pareados > 0 ? "alerta" : "neutro"}
        />
        <Contador
          valor={semParLocal}
          rotulo={`nossos sem par (de ${totalLocal})`}
          tom={semParLocal > 0 ? "alerta" : "neutro"}
        />
      </div>

      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder="Buscar por nome ou ID…"
        emptyMessage={
          erro ? "Sem dados: a leitura do GSS falhou." : "O GSS não tem nenhum registro aqui."
        }
        pageSize={25}
      />
    </div>
  );
}
