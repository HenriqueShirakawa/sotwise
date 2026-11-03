import type { NextRequest } from "next/server";
import * as XLSX from "xlsx";

import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import { formatDate, formatDateNumeric } from "@/lib/format";
import { BATCH_STATUS_LABELS } from "@/lib/status-colors";
import type { Database } from "@/types/database";

import type { EtdFactoryRow } from "../etd-factories-client";
import { parseListState } from "../list-params";
import { buildEtdRows, etdListQuery } from "../query";

export const dynamic = "force-dynamic";

type EtdListRow = Database["public"]["Views"]["etd_list"]["Row"];

/** "dd/mm/yyyy" → número de série do Excel (célula de data de verdade, que ordena e filtra). */
function excelDate(ddmmyyyy: string): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(ddmmyyyy);
  if (!m) return null;
  return (Date.UTC(+m[3], +m[2] - 1, +m[1]) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

const yesNo = (v: boolean) => (v ? "Yes" : "No");

/** Mesmas colunas e rótulos da lista (COLUMN_OPTIONS em ../etd-factories-client). */
const COLUMNS: { label: string; date?: boolean; value: (r: EtdFactoryRow) => string | number | null }[] = [
  { label: "Client", value: (r) => r.client },
  { label: "PO . Batches", value: (r) => `${r.po_number} ${r.batch_number}` },
  { label: "Factories", value: (r) => r.factory },
  { label: "Categories", value: (r) => r.category },
  { label: "Order date", date: true, value: (r) => excelDate(formatDateNumeric(r.order_date)) },
  { label: "Shipment Req.", date: true, value: (r) => excelDate(formatDateNumeric(r.shipment_req)) },
  { label: "Initial Date", date: true, value: (r) => excelDate(formatDateNumeric(r.initial_date)) },
  { label: "Current Date", date: true, value: (r) => excelDate(formatDateNumeric(r.current_date)) },
  { label: "Days Delay", value: (r) => r.days_delay },
  { label: "Last Updated", date: true, value: (r) => excelDate(formatDate(r.last_updated)) },
  { label: "Status Batches", value: (r) => BATCH_STATUS_LABELS[r.batch_status] },
  { label: "Ready Parts", value: (r) => yesNo(r.ready_parts) },
  { label: "Gap of Ready", value: (r) => r.gap_of_ready },
  { label: "Insp.", value: (r) => yesNo(r.inspection) },
  { label: "Dispatch loc.", value: (r) => r.dispatch_location },
  { label: "Dispatch date", date: true, value: (r) => excelDate(formatDateNumeric(r.dispatch_date)) },
];

/**
 * Download XLS da ETD Factories — exceção confirmada ao corte global de
 * exportações (docs §11). Exporta TODAS as linhas que a lista mostra com a
 * busca/filtros/ordenação atuais (mesma query de ../page.tsx, sem paginar).
 */
export async function GET(request: NextRequest): Promise<Response> {
  await requireFeature("etd_factories");
  const admin = createAdminClient();
  const state = parseListState(Object.fromEntries(request.nextUrl.searchParams));

  let failure: string | null = null;
  const list = await fetchAll<EtdListRow>(async (from, to) => {
    const res = await etdListQuery(admin, state).range(from, to);
    if (res.error) failure = res.error.message;
    return res;
  });
  if (failure) return new Response(`etd_list: ${failure}`, { status: 500 });

  const rows = buildEtdRows(list);
  const sheet = XLSX.utils.aoa_to_sheet([
    COLUMNS.map((c) => c.label),
    ...rows.map((r) => COLUMNS.map((c) => c.value(r))),
  ]);
  COLUMNS.forEach((c, col) => {
    if (!c.date) return;
    for (let row = 1; row <= rows.length; row++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
      if (cell && cell.t === "n") cell.z = "dd/mm/yyyy";
    }
  });
  sheet["!cols"] = COLUMNS.map((c) => ({ wch: Math.max(c.label.length + 2, c.date ? 12 : 14) }));

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "ETD Factories");
  const file: Buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });

  const today = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="etd-factories-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
