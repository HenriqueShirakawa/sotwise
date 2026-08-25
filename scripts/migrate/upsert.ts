/** Helpers de escrita no Supabase (service_role) + resolução de FK por bubble_id. */
import { supabaseAdmin } from "./client";

type Row = Record<string, unknown>;

/** Upsert idempotente por bubble_id, em lotes. */
export async function upsertByBubbleId(table: string, rows: Row[]): Promise<number> {
  const clean = rows.filter(Boolean);
  if (clean.length === 0) return 0;
  const BATCH = 500;
  let n = 0;
  for (let i = 0; i < clean.length; i += BATCH) {
    const chunk = clean.slice(i, i + BATCH);
    const { error } = await supabaseAdmin.from(table).upsert(chunk, { onConflict: "bubble_id" });
    if (error) throw new Error(`upsert ${table} [${i}..]: ${error.message}`);
    n += chunk.length;
  }
  return n;
}

/**
 * Upsert MESCLANDO por uma chave arbitrária (ON CONFLICT <onConflict> DO UPDATE).
 * Usado quando a linha já pode ter sido criada por outro caminho (ex.: um trigger
 * AFTER INSERT que semeia a linha por (order_id, step) sem bubble_id) e queremos
 * ENRIQUECÊ-la com os dados do Bubble, não colidir. Diferente do upsertByBubbleId
 * (que casa por bubble_id e quebraria numa unique diferente) e do upsertJunction
 * (que ignora duplicatas em vez de atualizar).
 */
export async function upsertByKey(table: string, rows: Row[], onConflict: string): Promise<number> {
  const clean = rows.filter(Boolean);
  if (clean.length === 0) return 0;
  const BATCH = 500;
  let n = 0;
  for (let i = 0; i < clean.length; i += BATCH) {
    const chunk = clean.slice(i, i + BATCH);
    const { error } = await supabaseAdmin.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`upsertByKey ${table} [${i}..]: ${error.message}`);
    n += chunk.length;
  }
  return n;
}

/** Upsert de tabela de junção (sem bubble_id) — ON CONFLICT na PK composta, DO NOTHING. */
export async function upsertJunction(table: string, rows: Row[], onConflict: string): Promise<number> {
  if (rows.length === 0) return 0;
  const BATCH = 500;
  let n = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await supabaseAdmin.from(table).upsert(chunk, { onConflict, ignoreDuplicates: true });
    if (error) throw new Error(`upsert(junction) ${table} [${i}..]: ${error.message}`);
    n += chunk.length;
  }
  return n;
}

/** Carrega bubble_id -> uuid de uma tabela (paginado). */
export async function loadIdMap(table: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("id, bubble_id")
      .not("bubble_id", "is", null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`loadIdMap ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as { id: string; bubble_id: string }[]) map.set(r.bubble_id, r.id);
    if (data.length < PAGE) break;
  }
  return map;
}

export async function tableCount(table: string): Promise<number> {
  const { count, error } = await supabaseAdmin.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return count ?? 0;
}

// ---- coerção de tipos vindos do Bubble ----
export function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
export function reqStr(v: unknown, fallback = ""): string {
  return str(v) ?? fallback;
}
export function bool(v: unknown): boolean {
  return v === true;
}
export function tsz(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
export function dateOnly(v: unknown): string | null {
  const iso = tsz(v);
  return iso ? iso.slice(0, 10) : null;
}
/** Resolve um id-ref do Bubble para o uuid novo via um map bubble_id->uuid. */
export function ref(map: Map<string, string>, v: unknown): string | null {
  const id = typeof v === "string" ? v : null;
  return id ? map.get(id) ?? null : null;
}
