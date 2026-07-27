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
export async function fetchPage(type: string, cursor = 0, limit = 100): Promise<BubblePage> {
  const url = `${BUBBLE_API_BASE}/obj/${encodeURIComponent(type)}?limit=${limit}&cursor=${cursor}`;
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

/** Todos os registros de um data type (ou até `max`). */
export async function fetchAll(type: string, opts: { max?: number; onPage?: (n: number, total: number) => void } = {}): Promise<BubbleRow[]> {
  const out: BubbleRow[] = [];
  let cursor = 0;
  for (;;) {
    const page = await fetchPage(type, cursor, 100);
    out.push(...page.results);
    opts.onPage?.(out.length, out.length + (page.remaining ?? 0));
    if (opts.max && out.length >= opts.max) return out.slice(0, opts.max);
    if (!page.remaining || page.results.length === 0) break;
    cursor += page.results.length;
  }
  return out;
}

/** Contagem total de um data type (via limit=1 → remaining + 1). */
export async function countType(type: string): Promise<number> {
  const p = await fetchPage(type, 0, 1);
  return (p.remaining ?? 0) + (p.results?.length ?? 0);
}
