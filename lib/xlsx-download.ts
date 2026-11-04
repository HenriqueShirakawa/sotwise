"use client";

import { useState } from "react";
import { toast } from "sonner";

import { formatDate, formatDateNumeric } from "@/lib/format";

/**
 * Download XLSX das listas (Orders, ETD Factories, Pre-loading, Shipments,
 * To do list — pedido do usuário em 04/11/2026): o arquivo é O QUE A TELA
 * MOSTRA. Mesmas linhas (busca, filtros e ordenação atuais, todas as páginas),
 * mesmas colunas visíveis na mesma ordem, mesmos rótulos. A planilha é montada
 * no navegador; a biblioteca (SheetJS) só carrega no clique.
 */

/** Como uma coluna da tela vira célula. `date`/`timestamp` viram data do Excel. */
export type XlsxColumn<Row> = {
  label: string;
  kind?: "date" | "timestamp";
  value: (row: Row) => string | number | null | undefined;
};

/** "dd/mm/yyyy" → número de série do Excel (célula de data de verdade, que ordena e filtra). */
function excelSerial(ddmmyyyy: string): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(ddmmyyyy);
  if (!m) return null;
  return (Date.UTC(+m[3], +m[2] - 1, +m[1]) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

function cell<Row>(col: XlsxColumn<Row>, row: Row): string | number | null {
  const v = col.value(row);
  if (v === undefined || v === null || v === "") return null;
  if (col.kind && typeof v === "string") {
    return excelSerial(col.kind === "date" ? formatDateNumeric(v) : formatDate(v));
  }
  return v;
}

export async function downloadXlsx<Row>({
  fileBase,
  sheetName,
  columnIds,
  columns,
  rows,
}: {
  fileBase: string;
  sheetName: string;
  /** Colunas visíveis da tabela, na ordem da tela. */
  columnIds: string[];
  columns: Partial<Record<string, XlsxColumn<Row>>>;
  rows: Row[];
}): Promise<void> {
  const XLSX = await import("xlsx");
  const cols = columnIds.flatMap((id) => (columns[id] ? [columns[id]] : []));

  const sheet = XLSX.utils.aoa_to_sheet([
    cols.map((c) => c.label),
    ...rows.map((r) => cols.map((c) => cell(c, r))),
  ]);
  cols.forEach((c, col) => {
    if (!c.kind) return;
    for (let row = 1; row <= rows.length; row++) {
      const target = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
      if (target && target.t === "n") target.z = "dd/mm/yyyy";
    }
  });
  sheet["!cols"] = cols.map((c) => ({ wch: Math.max(c.label.length + 2, c.kind ? 12 : 14) }));

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName.slice(0, 31));
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(book, `${fileBase}-${today}.xlsx`, { bookType: "xlsx" });
}

/**
 * Linhas de uma lista paginada no servidor: a rota `<lista>/export` devolve
 * TODAS as linhas da busca/filtros/ordenação atuais, no mesmo formato da página.
 */
export async function fetchAllRows<Row>(url: string): Promise<Row[]> {
  const res = await fetch(url, { cache: "no-store" });
  // Sessão caída vira redirect pro login (HTML) — não é JSON de linhas.
  if (!res.ok || !res.headers.get("Content-Type")?.includes("application/json")) {
    throw new Error(`export: ${res.status}`);
  }
  const body = (await res.json()) as { rows: Row[] };
  return body.rows;
}

/** Estado do botão: roda o download e mostra erro se falhar. */
export function useXlsxDownload(run: () => Promise<void>) {
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    setDownloading(true);
    try {
      await run();
    } catch {
      toast.error("Could not generate the XLSX file. Please try again.");
    } finally {
      setDownloading(false);
    }
  };
  return { downloading, download };
}

/** Junta os rótulos do menu de colunas (os mesmos da tela) com o valor de cada coluna. */
export function xlsxColumns<Row>(
  options: { id: string; label: string }[],
  defs: Partial<Record<string, Omit<XlsxColumn<Row>, "label"> & { label?: string }>>
): Partial<Record<string, XlsxColumn<Row>>> {
  const out: Partial<Record<string, XlsxColumn<Row>>> = {};
  for (const o of options) {
    const def = defs[o.id];
    if (def) out[o.id] = { ...def, label: def.label ?? o.label };
  }
  return out;
}
