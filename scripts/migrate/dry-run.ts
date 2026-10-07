/**
 * Dry-run do importador Bubble → Supabase (`MIGRATE_DRY_RUN=1 npm run migrate <fase>`).
 *
 * Com a flag, os helpers de escrita (upsert.ts) NÃO gravam: comparam cada linha
 * que seria gravada com o que já está no banco e acumulam um relatório por
 * tabela — quantas linhas entrariam (insert), mudariam (update, com a contagem
 * por coluna e exemplos) ou ficariam iguais, quantas teriam um valor
 * preenchido SOBRESCRITO por vazio, colisões de unique (po_number, pl_number,
 * order+lote, PL+etapa) e o que existe só no SOTWISE (fora do Bubble).
 *
 * Linhas novas ganham um id fictício (`dry:<bubble_id>`) para que as camadas
 * seguintes (lotes da order nova, linhas do lote novo…) também sejam contadas.
 */
import { supabaseAdmin } from "./client";

type Row = Record<string, unknown>;

export const DRY_RUN = process.env.MIGRATE_DRY_RUN === "1";

const FAKE = "dry:";
export const isFake = (v: unknown) => typeof v === "string" && v.startsWith(FAKE);

type TableReport = {
  input: number;
  insert: number;
  update: number;
  same: number;
  changedCols: Map<string, number>;
  nulledCols: Map<string, number>;
  examples: string[];
  conflicts: string[];
};

const reports = new Map<string, TableReport>();
/** bubble_id → id fictício das linhas que seriam criadas, por tabela. */
const fakeIds = new Map<string, Map<string, string>>();
/** bubble_ids vistos no Bubble, por tabela (para achar o que é só do SOTWISE). */
const seenBubble = new Map<string, Set<string>>();
const notes: string[] = [];

function report(table: string): TableReport {
  let r = reports.get(table);
  if (!r) {
    r = { input: 0, insert: 0, update: 0, same: 0, changedCols: new Map(), nulledCols: new Map(), examples: [], conflicts: [] };
    reports.set(table, r);
  }
  return r;
}

export function note(msg: string) {
  notes.push(msg);
}

/** Ids fictícios das linhas novas da tabela — loadIdMap soma isto ao mapa real. */
export function fakeIdMap(table: string): Map<string, string> {
  return fakeIds.get(table) ?? new Map();
}

/** Igualdade tolerante: timestamp por instante, data por dia, null ≡ undefined. */
function same(a: unknown, b: unknown): boolean {
  if (a === undefined) a = null;
  if (b === undefined) b = null;
  if (a === null || b === null) return a === b;
  if (typeof a === "string" && typeof b === "string") {
    if (a === b) return true;
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (/^\d{4}-\d{2}-\d{2}/.test(a) && /^\d{4}-\d{2}-\d{2}/.test(b) && Number.isFinite(ta) && Number.isFinite(tb)) {
      return a.length === 10 || b.length === 10 ? a.slice(0, 10) === b.slice(0, 10) : ta === tb;
    }
    return false;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

const keyOf = (row: Row, keys: string[]) => keys.map((k) => String(row[k] ?? "")).join("|");

/** Linhas existentes cujo `keys` bate com algum dos `rows` (consulta em pedaços). */
async function loadExisting(table: string, rows: Row[], keys: string[]): Promise<Map<string, Row>> {
  const out = new Map<string, Row>();
  const first = keys[0];
  const values = [...new Set(rows.map((r) => r[first]).filter((v) => v != null && !isFake(v)))] as string[];
  const CHUNK = 150;
  for (let i = 0; i < values.length; i += CHUNK) {
    const part = values.slice(i, i + CHUNK);
    for (let from = 0; ; from += 1000) {
      let q = supabaseAdmin.from(table).select("*").in(first, part);
      // Ordem estável entre páginas (sem ORDER BY o Postgres pode pular/repetir linhas).
      for (const k of keys) q = q.order(k);
      const { data, error } = await q.range(from, from + 999);
      if (error) throw new Error(`dry-run load ${table}: ${error.message}`);
      for (const r of (data ?? []) as Row[]) out.set(keyOf(r, keys), r);
      if (!data || data.length < 1000) break;
    }
  }
  return out;
}

/** Uniques a checar além da chave do upsert (o upsert de verdade quebraria nelas). */
const UNIQUES: Record<string, string[][]> = {
  orders: [["po_number"]],
  pre_loadings: [["pl_number"]],
  batches: [["order_id", "batch_number"]],
};

async function checkUniques(table: string, writes: { row: Row; existing: Row | null }[], r: TableReport) {
  for (const cols of UNIQUES[table] ?? []) {
    const candidates = writes.filter(({ row, existing }) =>
      cols.every((c) => row[c] !== undefined && row[c] !== null && !isFake(row[c])) &&
      (!existing || cols.some((c) => !same(existing[c], row[c])))
    );
    if (candidates.length === 0) continue;
    const taken = await loadExisting(table, candidates.map((w) => w.row), cols);
    // Dois registros do próprio Bubble disputando o mesmo valor também quebram.
    const inBatch = new Map<string, number>();
    for (const { row } of candidates) inBatch.set(keyOf(row, cols), (inBatch.get(keyOf(row, cols)) ?? 0) + 1);
    for (const { row, existing } of candidates) {
      const k = keyOf(row, cols);
      const holder = taken.get(k);
      if (holder && holder.id !== existing?.id) {
        r.conflicts.push(
          `${cols.join("+")}=${k} já é de outra linha (id ${holder.id}, bubble_id ${holder.bubble_id ?? "—"}) ← Bubble ${row.bubble_id ?? ""}`
        );
      } else if ((inBatch.get(k) ?? 0) > 1) {
        r.conflicts.push(`${cols.join("+")}=${k} repetido dentro do próprio Bubble (${row.bubble_id ?? ""})`);
      }
    }
  }
}

function label(table: string, row: Row, existing: Row | null): string {
  const pick = (r: Row | null) =>
    r?.po_number ?? r?.pl_number ?? r?.batch_number ?? r?.step ?? r?.bubble_id ?? r?.id ?? "";
  return `${table}:${pick(existing) || pick(row)}`;
}

/**
 * Compara `rows` com o banco pela chave do upsert. `junction` = só conta pares
 * novos (o upsert de junção ignora duplicatas, nunca atualiza).
 */
export async function dryDiff(table: string, rows: Row[], keys: string[], opts: { junction?: boolean } = {}) {
  const r = report(table);
  const clean = rows.filter(Boolean);
  r.input += clean.length;
  if (clean.some((row) => row.bubble_id)) {
    const set = seenBubble.get(table) ?? new Set<string>();
    for (const row of clean) if (row.bubble_id) set.add(String(row.bubble_id));
    seenBubble.set(table, set);
  }

  const existing = await loadExisting(table, clean, keys);
  const writes: { row: Row; existing: Row | null }[] = [];
  for (const row of clean) {
    const cur = keys.some((k) => isFake(row[k])) ? null : existing.get(keyOf(row, keys)) ?? null;
    if (!cur) {
      r.insert++;
      writes.push({ row, existing: null });
      if (row.bubble_id && keys[0] === "bubble_id") {
        const m = fakeIds.get(table) ?? new Map<string, string>();
        m.set(String(row.bubble_id), FAKE + row.bubble_id);
        fakeIds.set(table, m);
      }
      continue;
    }
    if (opts.junction) {
      r.same++;
      continue;
    }
    const diffs = Object.keys(row).filter((c) => !same(cur[c], row[c]));
    if (diffs.length === 0) {
      r.same++;
      continue;
    }
    r.update++;
    writes.push({ row, existing: cur });
    for (const c of diffs) {
      r.changedCols.set(c, (r.changedCols.get(c) ?? 0) + 1);
      if ((row[c] === null || row[c] === undefined) && cur[c] !== null && cur[c] !== undefined) {
        r.nulledCols.set(c, (r.nulledCols.get(c) ?? 0) + 1);
      }
    }
    if (r.examples.length < 8) {
      r.examples.push(
        `${label(table, row, cur)} → ${diffs
          .slice(0, 4)
          .map((c) => `${c}: ${JSON.stringify(cur[c])} → ${JSON.stringify(row[c])}`)
          .join("; ")}`
      );
    }
  }
  if (!opts.junction) await checkUniques(table, writes, r);
  return clean.length;
}

/** O que está no banco e NÃO veio do Bubble (sem bubble_id ou bubble_id fora da carga). */
async function sotwiseOnly(table: string, labelCols: string) {
  const seen = seenBubble.get(table);
  if (!seen) return null;
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(`id, bubble_id, ${labelCols}`)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`dry-run sotwise-only ${table}: ${error.message}`);
    rows.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }
  const noBubble = rows.filter((r) => !r.bubble_id);
  const gone = rows.filter((r) => r.bubble_id && !seen.has(String(r.bubble_id)));
  const show = (list: Row[]) =>
    list
      .slice(0, 12)
      .map((r) => labelCols.split(",").map((c) => r[c.trim()]).filter((v) => v != null).join(" ") || r.id)
      .join(", ");
  return { noBubble: noBubble.length, gone: gone.length, noBubbleEx: show(noBubble), goneEx: show(gone) };
}

export async function printDryRunReport() {
  console.log("\n\n================ DRY-RUN (nada foi gravado) ================\n");
  for (const [table, r] of reports) {
    console.log(`■ ${table}: ${r.input} do Bubble → ${r.insert} novas, ${r.update} mudariam, ${r.same} iguais`);
    if (r.changedCols.size) {
      const cols = [...r.changedCols.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`);
      console.log(`    colunas que mudariam: ${cols.join(", ")}`);
    }
    if (r.nulledCols.size) {
      const cols = [...r.nulledCols.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`);
      console.log(`    ⚠️ valor preenchido que viraria VAZIO: ${cols.join(", ")}`);
    }
    for (const ex of r.examples) console.log(`    ex.: ${ex}`);
    if (r.conflicts.length) {
      console.log(`    ❌ ${r.conflicts.length} colisão(ões) de unique — o upsert de verdade FALHARIA:`);
      for (const c of r.conflicts.slice(0, 15)) console.log(`       ${c}`);
    }
  }

  console.log("\n---- Só no SOTWISE (o upsert NÃO apaga; ficariam como estão) ----");
  const only: [string, string][] = [
    ["orders", "po_number, gss_id"],
    ["batches", "batch_number, gss_id"],
    ["order_factory_category", "order_id"],
    ["pre_loadings", "pl_number, gss_id"],
    ["shipments", "pre_loading_id, status"],
  ];
  for (const [table, cols] of only) {
    const o = await sotwiseOnly(table, cols);
    if (!o) continue;
    console.log(`■ ${table}: ${o.noBubble} sem bubble_id (criadas no SOTWISE)${o.noBubble ? ` — ${o.noBubbleEx}` : ""}`);
    console.log(`  ${o.gone} com bubble_id que não veio nesta carga (apagadas no Bubble?)${o.gone ? ` — ${o.goneEx}` : ""}`);
  }

  if (notes.length) {
    console.log("\n---- Notas ----");
    for (const n of notes) console.log(`• ${n}`);
  }
}
