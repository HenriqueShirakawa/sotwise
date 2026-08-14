/**
 * Motor de sync GSS → SOTWISE (bibliotecas). Um único núcleo, dois pontos de
 * entrada: `scripts/sync-gss/sync.ts` (CLI) e `app/api/cron/sync-gss` (agendado).
 *
 * Recebe o client do Supabase por parâmetro de propósito — `lib/supabase/admin`
 * tem `import "server-only"`, que lança em script tsx. Mesmo motivo pelo qual
 * `lib/gss/client.ts` não tem o guard.
 *
 * O que ele faz, por recurso (ver docs/INTEGRACAO_GSS.md §9):
 *  1. LINK    — linha local sem `gss_id` que casa por nome ganha o vínculo.
 *  2. FIELDS  — linha já pareada tem os campos atualizados a partir do GSS.
 *               É isto que faz um rename lá chegar aqui.
 *  3. INSERT  — o que só existe no GSS entra como linha nova.
 *  4. REVIVE  — pareada e soft-deletada aqui, mas ainda viva no GSS → volta.
 *  5. MISSING — pareada aqui e ausente no GSS → sumiu. Só relata; o soft-delete
 *               exige `softDelete: true` (apagar por engano é caro demais para
 *               ser o padrão, ainda mais sem `deleted_at` na origem).
 *
 * A ordem importa: o par é procurado primeiro por `gss_id` e só depois por nome.
 * Casar por nome primeiro fazia um rename no GSS virar INSERT — que estourava a
 * unique de `gss_id` e derrubava a execução.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../types/database";
import {
  gssGet,
  GSS_ENDPOINTS,
  type GssBusinessUnit,
  type GssCity,
  type GssCountry,
  type GssCustomer,
  type GssExporter,
  type GssOrderType,
  type GssPort,
  type GssSupplier,
  type GssSupplierCategory,
} from "./client";

export type LibTable =
  | "countries" | "cities" | "pols" | "pods" | "clients" | "exporters"
  | "order_types" | "business_units" | "factories" | "categories";

export type SyncOptions = {
  /** false = dry-run: monta o plano inteiro e não escreve nada. */
  commit: boolean;
  /** Só grava vínculos (`gss_id`); nada de campos, inserts ou revives. */
  pairOnly: boolean;
  /** Restringe os INSERTs a estas tabelas. `null` = todas. */
  insertOnly: Set<string> | null;
  /** Libera o insert em `pols`, bloqueado por granularidade (§9.3). */
  allowPolInserts: boolean;
  /** Aplica `deleted_at` no que sumiu do GSS. Padrão: só relata. */
  softDelete: boolean;
  /**
   * Deixa o GSS reescrever `name` quando a diferença é só acento ou caixa.
   * Padrão `false`, e não é purismo: o GSS grava os portos brasileiros sem
   * acento (`Itapoa`, `Paranagua`, `Pecem`) e alterna caixa nas fábricas
   * (`AIMESK`/`Aimesk`), então aplicar essas divergências degradaria nomes que
   * aqui estão certos. Rename de verdade — o que muda o nome normalizado —
   * passa sempre, com ou sem esta opção.
   */
  forceCasing: boolean;
};

export const DEFAULT_OPTIONS: SyncOptions = {
  commit: false,
  pairOnly: false,
  insertOnly: null,
  allowPolInserts: false,
  softDelete: false,
  forceCasing: false,
};

/**
 * Países do GSS que não entram na nossa biblioteca (decisão de 2026-08-14):
 * os 4 primeiros são placeholders internos deles, não países, e virariam opção
 * de dropdown aqui. "Singapura" é a mesma Singapore em português — como `gss_id`
 * é `unique`, uma linha nossa não pode carregar os dois ids, então fica a grafia
 * inglesa. Consequência aceita: `customer` apontando para qualquer um dos 5 chega
 * com `country_id` nulo; a duplicata é para o dono do GSS corrigir na origem.
 */
export const COUNTRY_SKIP = new Set(["generic", "legacy import", "to be defined", "unknown", "singapura"]);

export function norm(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

type LocalRow = { id: string; name: string; gss_id: string | null; deleted_at: string | null } & Record<string, unknown>;

export type ResourcePlan = {
  table: LibTable;
  /** Linha existente que passa a apontar para o GSS. */
  links: { id: string; gss_id: string; name: string }[];
  /** Campos a atualizar numa linha já pareada (o rename entra aqui). */
  fields: { id: string; name: string; changes: Record<string, unknown> }[];
  inserts: Record<string, unknown>[];
  /** Pareada, soft-deletada aqui, ainda presente no GSS. */
  revives: { id: string; name: string }[];
  /** Pareada aqui, ausente do GSS. */
  missing: { id: string; name: string; gss_id: string }[];
  /** Grupos locais de nome repetido (fila de merge, §9.5). */
  dupesAll: { name: string; ids: string[] }[];
  matched: number;
  localRows: number;
  localNames: number;
  /** Nomes locais vivos sem par no GSS. */
  localOnly: number;
  skippedInserts: boolean;
};

/** Se os INSERTs desta tabela entram na gravação. Pura, para o dry-run bater. */
export function willInsert(table: LibTable, o: SyncOptions): boolean {
  if (o.pairOnly) return false;
  if (o.insertOnly && !o.insertOnly.has(table)) return false;
  if (table === "pols" && !o.allowPolInserts) return false;
  return true;
}

type DB = SupabaseClient<Database>;

/**
 * Recorte mínimo do builder do supabase-js. `sb.from(x)` com `x` de tipo união
 * colapsa os tipos gerados para `never`, então o cast é inevitável — mas um
 * contrato explícito documenta o que de fato usamos, ao contrário de um `any`.
 */
type PgError = { message: string } | null;
type LooseSelect = {
  order: (column: string) => LooseSelect;
  range: (from: number, to: number) => Promise<{ data: unknown[] | null; error: PgError }>;
};
type LooseTable = {
  select: (columns: string) => LooseSelect;
  update: (values: Record<string, unknown>) => { eq: (column: string, value: string) => Promise<{ error: PgError }> };
  insert: (rows: Record<string, unknown>[]) => Promise<{ error: PgError }>;
};
const loose = (sb: DB, table: LibTable): LooseTable => sb.from(table) as unknown as LooseTable;

/** Carrega a tabela inteira, inclusive soft-deletadas (para REVIVE e unique). */
async function loadLocal(sb: DB, table: LibTable): Promise<LocalRow[]> {
  const out: LocalRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    // order by id: sem ordem explícita o Postgres não garante a mesma sequência
    // entre execuções, e a escolha da linha que recebe o vínculo tem de ser estável.
    const { data, error } = await loose(sb, table).select("*").order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`load ${table}: ${error.message}`);
    const rows = (data ?? []) as LocalRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function fetchGss<T>(endpoint: string): Promise<T[]> {
  const r = await gssGet<T[]>(endpoint);
  if (!r.ok) throw new Error(`GSS ${endpoint}: ${r.error}`);
  return r.data;
}

/**
 * Monta o plano de um recurso. `buildPayload` devolve o registro completo como
 * ele deveria estar aqui; serve tanto de INSERT quanto de referência do FIELDS.
 */
function planResource<G>(
  table: LibTable,
  local: LocalRow[],
  gssItems: G[],
  getName: (g: G) => string | null,
  getId: (g: G) => number,
  buildPayload: (g: G) => Record<string, unknown>,
  opts: SyncOptions
): ResourcePlan {
  const alive = local.filter((r) => r.deleted_at === null);

  const byGssId = new Map<string, LocalRow>();
  for (const r of local) if (r.gss_id) byGssId.set(r.gss_id, r);

  const byNorm = new Map<string, LocalRow[]>();
  for (const r of alive) {
    const k = norm(r.name);
    if (!k) continue;
    (byNorm.get(k) ?? byNorm.set(k, []).get(k)!).push(r);
  }

  // Deduplica o GSS por nome: menor id vence (a API devolve o array sem ordem
  // fixa). `idsByNorm` guarda todos os ids daquele nome — um vínculo já gravado
  // em qualquer um deles continua válido (sticky, §9.4).
  const gssByNorm = new Map<string, G>();
  const idsByNorm = new Map<string, Set<string>>();
  for (const g of gssItems) {
    const k = norm(getName(g));
    if (!k) continue;
    const cur = gssByNorm.get(k);
    if (!cur || getId(g) < getId(cur)) gssByNorm.set(k, g);
    (idsByNorm.get(k) ?? idsByNorm.set(k, new Set()).get(k)!).add(String(getId(g)));
  }

  const links: ResourcePlan["links"] = [];
  const fields: ResourcePlan["fields"] = [];
  const inserts: ResourcePlan["inserts"] = [];
  const revives: ResourcePlan["revives"] = [];
  const seenLocal = new Set<string>(); // uuids locais que o GSS cobriu
  let matched = 0;

  for (const [k, g] of gssByNorm) {
    const gssId = String(getId(g));
    const payload = buildPayload(g);
    const validIds = idsByNorm.get(k)!;

    // 1) par direto por gss_id — autoritativo, sobrevive a rename no GSS.
    let row = byGssId.get(gssId);
    // 2) sticky: outro id do mesmo nome já vinculado aqui vale como par.
    if (!row) {
      for (const id of validIds) {
        const cand = byGssId.get(id);
        if (cand) { row = cand; break; }
      }
    }
    // 3) por nome, só em linha ainda SEM vínculo — nunca roubar de outro id.
    if (!row) row = (byNorm.get(k) ?? []).find((r) => !r.gss_id);

    if (!row) {
      inserts.push({ ...payload, gss_id: gssId });
      continue;
    }

    matched++;
    seenLocal.add(row.id);
    if (!row.gss_id) links.push({ id: row.id, gss_id: gssId, name: row.name });

    const changes: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(payload)) {
      // null/undefined não sobrescreve: ausência na origem costuma ser tradução
      // de FK que não resolveu, não uma limpeza deliberada do dado.
      if (value === null || value === undefined) continue;
      if (row[field] === value) continue;
      // Nome que só difere em acento/caixa: a nossa grafia fica (ver forceCasing).
      if (field === "name" && !opts.forceCasing && norm(row.name) === norm(String(value))) continue;
      changes[field] = value;
    }
    if (Object.keys(changes).length) fields.push({ id: row.id, name: row.name, changes });
    if (row.deleted_at !== null) revives.push({ id: row.id, name: row.name });
  }

  // sumiu do GSS: tinha vínculo, está vivo aqui, e o GSS não o listou.
  const allGssIds = new Set<string>();
  for (const g of gssItems) allGssIds.add(String(getId(g)));
  const missing = alive
    .filter((r) => r.gss_id && !allGssIds.has(r.gss_id))
    .map((r) => ({ id: r.id, name: r.name, gss_id: r.gss_id! }));

  const dupesAll: ResourcePlan["dupesAll"] = [];
  for (const rows of byNorm.values()) {
    if (rows.length > 1) dupesAll.push({ name: rows[0].name, ids: rows.map((r) => r.id) });
  }

  const localOnly = [...byNorm.values()].filter((rows) => !rows.some((r) => seenLocal.has(r.id))).length;

  return {
    table, links, fields, inserts, revives, missing, dupesAll, matched,
    localRows: alive.length,
    localNames: byNorm.size,
    localOnly,
    skippedInserts: inserts.length > 0 && !willInsert(table, opts),
  };
}

/** Grava o plano. Silencioso em dry-run. */
async function applyPlan(sb: DB, plan: ResourcePlan, opts: SyncOptions): Promise<void> {
  if (!opts.commit) return;
  const t = () => loose(sb, plan.table);
  const CH = 25;

  // 1) vínculos
  for (let i = 0; i < plan.links.length; i += CH) {
    await Promise.all(plan.links.slice(i, i + CH).map(async (u) => {
      const { error } = await t().update({ gss_id: u.gss_id }).eq("id", u.id);
      if (error) throw new Error(`link ${plan.table} ${u.id}: ${error.message}`);
    }));
  }
  if (opts.pairOnly) return;

  // 2) campos (o rename chega por aqui)
  for (let i = 0; i < plan.fields.length; i += CH) {
    await Promise.all(plan.fields.slice(i, i + CH).map(async (u) => {
      const { error } = await t().update(u.changes).eq("id", u.id);
      if (error) throw new Error(`update ${plan.table} ${u.id}: ${error.message}`);
    }));
  }

  // 3) revive
  for (let i = 0; i < plan.revives.length; i += CH) {
    await Promise.all(plan.revives.slice(i, i + CH).map(async (u) => {
      const { error } = await t().update({ deleted_at: null }).eq("id", u.id);
      if (error) throw new Error(`revive ${plan.table} ${u.id}: ${error.message}`);
    }));
  }

  // 4) inserts
  if (willInsert(plan.table, opts)) {
    const B = 500;
    for (let i = 0; i < plan.inserts.length; i += B) {
      const { error } = await t().insert(plan.inserts.slice(i, i + B));
      if (error) throw new Error(`insert ${plan.table} [${i}..]: ${error.message}`);
    }
  }

  // 5) soft-delete do que sumiu (opt-in)
  if (opts.softDelete && plan.missing.length) {
    const now = new Date().toISOString();
    for (let i = 0; i < plan.missing.length; i += CH) {
      await Promise.all(plan.missing.slice(i, i + CH).map(async (u) => {
        const { error } = await t().update({ deleted_at: now }).eq("id", u.id);
        if (error) throw new Error(`soft-delete ${plan.table} ${u.id}: ${error.message}`);
      }));
    }
  }
}

/** Linhas que o plano grava — o que vai para `gss_sync_state.rows_upserted`. */
export function writeCount(p: ResourcePlan, o: SyncOptions): number {
  if (o.pairOnly) return p.links.length;
  return p.links.length + p.fields.length + p.revives.length + (willInsert(p.table, o) ? p.inserts.length : 0);
}

async function recordState(sb: DB, plan: ResourcePlan, opts: SyncOptions, error?: string): Promise<void> {
  if (!opts.commit) return;
  const { error: e } = await sb.from("gss_sync_state").upsert(
    {
      resource: plan.table,
      last_run_at: new Date().toISOString(),
      last_status: error ? "error" : "ok",
      last_error: error ?? null,
      rows_upserted: writeCount(plan, opts),
      rows_deleted: opts.softDelete ? plan.missing.length : 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "resource" }
  );
  // Falha de telemetria não derruba um sync que já gravou o dado real.
  if (e) console.warn(`gss_sync_state ${plan.table}: ${e.message}`);
}

/**
 * Executa o sync inteiro, na ordem de FK do §4.3 (countries primeiro, porque
 * `clients.country_id` depende do mapa dele).
 */
export async function runSync(sb: DB, options: Partial<SyncOptions> = {}): Promise<ResourcePlan[]> {
  const opts: SyncOptions = { ...DEFAULT_OPTIONS, ...options };
  const plans: ResourcePlan[] = [];

  const run = async (p: ResourcePlan) => {
    try {
      await applyPlan(sb, p, opts);
      await recordState(sb, p, opts);
    } catch (err) {
      await recordState(sb, p, opts, err instanceof Error ? err.message : String(err));
      throw err;
    }
    plans.push(p);
    return p;
  };

  // 1) countries — os placeholders do GSS não entram (COUNTRY_SKIP).
  const countries = (await fetchGss<GssCountry>(GSS_ENDPOINTS.country)).filter((c) => !COUNTRY_SKIP.has(norm(c.name)));
  await run(planResource("countries", await loadLocal(sb, "countries"), countries,
    (c) => c.name, (c) => c.id, (c) => ({ name: c.name }), opts));

  // mapa id-do-GSS → uuid local, para traduzir clients.country_id. Relido depois
  // do apply para enxergar os países recém-inseridos.
  const countryMap = new Map<string, string>();
  for (const r of await loadLocal(sb, "countries")) if (r.gss_id && r.deleted_at === null) countryMap.set(r.gss_id, r.id);

  // 2) independentes
  await run(planResource("cities", await loadLocal(sb, "cities"), await fetchGss<GssCity>(GSS_ENDPOINTS.city),
    (c) => c.name, (c) => c.id, (c) => ({ name: c.name }), opts));

  // `port` roteado por país: China → pols (embarque), resto → pods (destino).
  const ports = await fetchGss<GssPort>(GSS_ENDPOINTS.port);
  const isChina = (p: GssPort) => norm(p.country_name) === "china";
  await run(planResource("pols", await loadLocal(sb, "pols"), ports.filter(isChina),
    (p) => p.name, (p) => p.id, (p) => ({ name: p.name }), opts));
  await run(planResource("pods", await loadLocal(sb, "pods"), ports.filter((p) => !isChina(p)),
    (p) => p.name, (p) => p.id, (p) => ({ name: p.name }), opts));

  await run(planResource("exporters", await loadLocal(sb, "exporters"), await fetchGss<GssExporter>(GSS_ENDPOINTS.exporter),
    (e) => e.name, (e) => e.id, (e) => ({ name: e.name, acronym: e.code ?? e.name.slice(0, 8) }), opts));
  await run(planResource("order_types", await loadLocal(sb, "order_types"), await fetchGss<GssOrderType>(GSS_ENDPOINTS.orderType),
    (o) => o.name, (o) => o.id, (o) => ({ name: o.name }), opts));
  await run(planResource("business_units", await loadLocal(sb, "business_units"), await fetchGss<GssBusinessUnit>(GSS_ENDPOINTS.businessUnit),
    (b) => b.name, (b) => b.id, (b) => ({ name: b.name }), opts));

  // 3) clients — country_id traduzido de id do GSS para uuid local
  await run(planResource("clients", await loadLocal(sb, "clients"), await fetchGss<GssCustomer>(GSS_ENDPOINTS.customer),
    (c) => c.name, (c) => c.id,
    (c) => ({ name: c.name, country_id: c.country != null ? countryMap.get(String(c.country)) ?? null : null }), opts));

  // 4) factories ← supplier
  await run(planResource("factories", await loadLocal(sb, "factories"), await fetchGss<GssSupplier>(GSS_ENDPOINTS.supplier),
    (s) => s.company_name, (s) => s.id, (s) => ({ name: s.company_name }), opts));

  // 5) categories ← supplier-category (a category distinta, não a junção)
  const sc = await fetchGss<GssSupplierCategory>(GSS_ENDPOINTS.supplierCategory);
  const catById = new Map<number, string>();
  for (const row of sc) if (!catById.has(row.category)) catById.set(row.category, row.category_name);
  const cats = [...catById.entries()].map(([id, name]) => ({ id, name }));
  await run(planResource("categories", await loadLocal(sb, "categories"), cats,
    (c) => c.name, (c) => c.id, (c) => ({ name: c.name }), opts));

  return plans;
}
