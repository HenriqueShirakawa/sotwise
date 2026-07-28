/**
 * Fetcher da Bubble Data API (LIVE). Leitura pública (GET sem token).
 * Paginação por cursor/limit (100/página). Resposta: { response: { results, cursor, remaining, count } }.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

export const BUBBLE_API_BASE =
  (process.env.BUBBLE_API_BASE || "https://agksystem.com/api/1.1").replace(/\/+$/, "");

export type BubbleRow = Record<string, unknown> & { _id: string };

interface BubblePage {
  results: BubbleRow[];
  cursor: number;
  remaining: number;
  count: number;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Uma página de um data type. Retenta em erro de rede / 429 / 5xx. */
export async function fetchPage(
  type: string,
  cursor = 0,
  limit = 100,
  extra: { sortField?: string; descending?: boolean; constraints?: unknown[] } = {}
): Promise<BubblePage> {
  const params = new URLSearchParams({ limit: String(limit), cursor: String(cursor) });
  if (extra.sortField) params.set("sort_field", extra.sortField);
  if (extra.descending !== undefined) params.set("descending", String(extra.descending));
  if (extra.constraints) params.set("constraints", JSON.stringify(extra.constraints));
  const url = `${BUBBLE_API_BASE}/obj/${encodeURIComponent(type)}?${params}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429 || res.status >= 500) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`Bubble ${type} cursor=${cursor}: HTTP ${res.status} ${await res.text()}`);
      const json = (await res.json()) as { response: BubblePage };
      return json.response;
    } catch (e) {
      lastErr = e;
      await sleep(400 * (attempt + 1));
    }
  }
  throw new Error(`Falha ao buscar ${type} (cursor=${cursor}): ${String(lastErr)}`);
}

/**
 * Todos os registros de um data type (ou até `max`).
 *
 * A Data API do Bubble trava o cursor em ~50.000 resultados por consulta:
 * a partir daí `results` volta vazio para sempre, mesmo com `remaining` > 0.
 * Contorna isso ordenando por "Created Date" e, ao detectar a trava,
 * reiniciando o cursor com uma constraint `> última data vista` — um novo
 * "início" de paginação. Dedup por `_id` cobre eventuais empates na borda.
 */
export async function fetchAll(type: string, opts: { max?: number; onPage?: (n: number, total: number) => void } = {}): Promise<BubbleRow[]> {
  const SORT_FIELD = "Created Date";
  const seen = new Map<string, BubbleRow>();
  let cursor = 0;
  let constraints: unknown[] | undefined;
  let lastSortValue: string | null = null;

  for (;;) {
    const page = await fetchPage(type, cursor, 100, { sortField: SORT_FIELD, descending: false, constraints });
    for (const r of page.results) seen.set(r._id, r);
    if (page.results.length > 0) {
      const last = page.results[page.results.length - 1][SORT_FIELD];
      if (typeof last === "string") lastSortValue = last;
    }
    opts.onPage?.(seen.size, seen.size + (page.remaining ?? 0));
    if (opts.max && seen.size >= opts.max) break;

    if (page.results.length === 0) {
      if (!page.remaining || !lastSortValue) break; // esgotou de verdade
      cursor = 0;
      constraints = [{ key: SORT_FIELD, constraint_type: "greater than", value: lastSortValue }];
      continue;
    }
    cursor += page.results.length;
  }

  const out = [...seen.values()];
  return opts.max ? out.slice(0, opts.max) : out;
}

/** Contagem total de um data type (via limit=1 → remaining + 1). */
export async function countType(type: string): Promise<number> {
  const p = await fetchPage(type, 0, 1);
  return (p.remaining ?? 0) + (p.results?.length ?? 0);
}
