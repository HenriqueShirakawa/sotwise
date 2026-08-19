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
  type GssAgent,
  type GssCarrier,
} from "./client";

export type LibTable =
  | "countries" | "cities" | "pols" | "pods" | "clients" | "exporters"
  | "order_types" | "business_units" | "factories" | "categories"
  | "agents" | "carriers";

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

/**
 * Linhas pareadas em que a NOSSA grafia fica, mesmo com o GSS sendo dono.
 * Revisadas uma a uma em 14/08/2026: nos quatro casos o nome local carrega mais
 * informação (província, razão social) ou é o rótulo já consolidado nas telas.
 * Diferente de `forceCasing`, que trata variação de acento/caixa em massa, aqui
 * a diferença é real — e ainda assim a nossa versão é a melhor.
 * Chave: `<tabela>:<gss_id>`.
 */
export const NOME_LOCAL_VENCE = new Set([
  "factories:199", // "Zhejiang Kreation" > "Kreation" — a província distingue a planta
  "carriers:1", // "MSC - Mediterranean Shg Co" > "MSC"
  "order_types:4", // "Samples" > "Sample" — rótulo em 77 orders
  "clients:38", // "Marquinhos" > "Marquinho"
]);

export function norm(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Forma reduzida para comparar nomes de empresa: sem pontuação e sem os sufixos
 * jurídicos, que são ruído — "Amass Freight Intl (ShenZhen) Co., Ltd" e "Amass
 * Freight Intl Shenzhen" são a mesma empresa escrita por duas pessoas.
 */
const SUFIXOS = /\b(ltda?|ltd|co|inc|s\.?a|sa|cia|company|limited|corp|group|do brasil|brasil|brazil|china)\b/g;
function nomeBase(s: string): string {
  return norm(s).replace(/[.,\-–—/()'"&]/g, " ").replace(SUFIXOS, " ").replace(/\s+/g, " ").trim();
}

/** Distância de edição (Levenshtein), com duas linhas em vez da matriz inteira. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let cur = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + custo);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** 0..1. Combina edição com contenção — "Amass" dentro de "Amass Freight" conta. */
export function semelhanca(a: string, b: string): number {
  const x = nomeBase(a);
  const y = nomeBase(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const porEdicao = 1 - levenshtein(x, y) / Math.max(x.length, y.length);
  // Contenção por PALAVRA, não por substring: "MSC" é palavra inteira dentro de
  // "MSC Mediterranean Shg", e "Kreation" dentro de "Zhejiang Kreation" — os
  // dois são a mesma empresa. Já "YI" não é palavra de "Yican", só um pedaço
  // dela, e era isso que fazia um nome de duas letras casar com meia base.
  const tx = x.split(" ").filter((t) => t.length >= 3);
  const ty = y.split(" ").filter((t) => t.length >= 3);
  const curto = tx.length <= ty.length ? tx : ty;
  const longo = new Set(tx.length <= ty.length ? ty : tx);
  const contido = curto.length > 0 && curto.every((t) => longo.has(t)) ? 0.9 : 0;
  return Math.max(porEdicao, contido);
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
  /**
   * Pares que NÃO casaram exato mas são parecidos o bastante para serem a mesma
   * coisa digitada de dois jeitos. Nunca gravados — só relatados para revisão
   * humana, porque o custo de um falso positivo é um vínculo errado.
   */
  quaseCasam: { gssId: string; gssName: string; localId: string; localName: string; score: number; emailBate: boolean | null }[];
  matched: number;
  localRows: number;
  localNames: number;
  /** Nomes locais vivos sem par no GSS. */
  localOnly: number;
  skippedInserts: boolean;
};

/**
 * Junções sincronizadas como CONJUNTO (docs/INTEGRACAO_GSS.md §4.3): não têm id
 * nem `gss_id` próprios, então o par é reconstruído traduzindo os ids do GSS para
 * os uuids locais. Hoje só `category_factories` (Factory × Category), vinda do
 * endpoint `supplier-category`. As outras três (`city_pols`, `agent_contacts`,
 * `carrier_agents`) cabem aqui quando entrarem.
 */
export type JunctionTable = "category_factories";

export type JunctionPlan = {
  table: JunctionTable;
  parentCol: string;
  childCol: string;
  /** Pares presentes no GSS e ausentes aqui — entram (padrão). */
  inserts: Record<string, string>[];
  /**
   * Pares que existem aqui, sumiram do GSS e têm OS DOIS lados vinculados ao GSS
   * (`gss_id`). Vínculo com lado local-only nunca entra nesta lista — não é do
   * GSS para apagar. Aplicado só com `softDelete` (hard delete, sem volta).
   */
  deletes: Record<string, string>[];
  /** Pares do GSS que já batem com um vínculo local — nada a fazer. */
  matched: number;
  /** Total de pares do GSS que resolveram os dois lados para uuid local. */
  desired: number;
  /** Vínculos hoje na tabela. */
  current: number;
  /**
   * Pares do GSS em que um dos lados não tem par local (fábrica/categoria ainda
   * sem `gss_id`, obsoleta, ou segurada na fila de merge). Só contados.
   */
  unresolved: number;
  appliedDeletes: boolean;
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

/** Builder mínimo para a junção: sem update, com delete por PK composta. */
type LooseJunction = {
  select: (columns: string) => LooseSelect;
  insert: (rows: Record<string, unknown>[]) => Promise<{ error: PgError }>;
  delete: () => { eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<{ error: PgError }> } };
};
const looseJ = (sb: DB, table: JunctionTable): LooseJunction => sb.from(table) as unknown as LooseJunction;

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
  opts: SyncOptions,
  /**
   * Chave alternativa de pareamento (hoje: e-mail). Onde os dois lados guardam
   * e-mail, ele confirma o par que o nome sugere e ainda pega o caso de nome
   * escrito diferente. Só vale como CRITÉRIO — o valor do GSS nunca sobrescreve
   * o nosso (o cadastro deles traz genéricos como `msc@msc.com`).
   */
  altKey?: { gss: (g: G) => string | null; local: string },
  /**
   * Campos que o GSS só PREENCHE (quando vazio aqui) e nunca sobrescreve. Para
   * `agents`/`carriers` o cadastro deles ainda é semente — `asiashipping@as.com`
   * contra o nosso `sales15.tsn@cn-asgroup.com` — e trocar um e-mail operacional
   * por um genérico é perda, não sincronização.
   */
  fillOnly?: Set<string>
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

  // índice pela chave alternativa (e-mail), quando o recurso tem uma
  const byAlt = new Map<string, LocalRow>();
  if (altKey) {
    for (const r of alive) {
      const v = norm(String(r[altKey.local] ?? ""));
      if (!v || v === "n/a" || v === "na") continue; // placeholders do cadastro
      if (!byAlt.has(v)) byAlt.set(v, r);
    }
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
    // 4) pela chave alternativa (e-mail): pega o par cujo nome está escrito
    //    diferente dos dois lados.
    if (!row && altKey) {
      const v = norm(altKey.gss(g));
      const cand = v && v !== "n/a" && v !== "na" ? byAlt.get(v) : undefined;
      if (cand && !cand.gss_id) row = cand;
    }

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
      // preenche só o que está vazio aqui
      if (fillOnly?.has(field) && row[field] !== null && row[field] !== undefined && row[field] !== "") continue;
      // Nome que só difere em acento/caixa: a nossa grafia fica (ver forceCasing).
      if (field === "name" && !opts.forceCasing && norm(row.name) === norm(String(value))) continue;
      // Nome que a revisão humana decidiu preservar.
      if (field === "name" && NOME_LOCAL_VENCE.has(`${table}:${gssId}`)) continue;
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

  // Candidatos por semelhança: cada item do GSS que virou INSERT contra as
  // linhas locais que sobraram sem vínculo. Cadastro manual erra grafia, e um
  // INSERT aqui pode ser, na verdade, a mesma entidade já existente.
  const quaseCasam: ResourcePlan["quaseCasam"] = [];
  const sobraram = alive.filter((r) => !r.gss_id && !seenLocal.has(r.id));
  for (const [k, g] of gssByNorm) {
    if (byNorm.has(k)) continue; // casou exato, não é candidato
    const nomeGss = getName(g) ?? "";
    let melhor: { row: LocalRow; score: number } | null = null;
    for (const r of sobraram) {
      const score = semelhanca(nomeGss, r.name);
      if (score >= 0.82 && (!melhor || score > melhor.score)) melhor = { row: r, score };
    }
    if (!melhor) continue;
    const eGss = altKey ? norm(altKey.gss(g)) : "";
    const eLocal = altKey ? norm(String(melhor.row[altKey.local] ?? "")) : "";
    quaseCasam.push({
      gssId: String(getId(g)),
      gssName: nomeGss,
      localId: melhor.row.id,
      localName: melhor.row.name,
      score: Math.round(melhor.score * 100) / 100,
      emailBate: altKey && eGss && eLocal ? eGss === eLocal : null,
    });
  }
  quaseCasam.sort((a, b) => b.score - a.score);

  const localOnly = [...byNorm.values()].filter((rows) => !rows.some((r) => seenLocal.has(r.id))).length;

  return {
    table, links, fields, inserts, revives, missing, dupesAll, quaseCasam, matched,
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

/** Carrega a junção inteira (par de uuids). Ordenada para paginar estável. */
async function loadJunction(
  sb: DB,
  table: JunctionTable,
  parentCol: string,
  childCol: string
): Promise<Record<string, string>[]> {
  const out: Record<string, string>[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await looseJ(sb, table)
      .select(`${parentCol},${childCol}`)
      .order(parentCol)
      .order(childCol)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load ${table}: ${error.message}`);
    const rows = (data ?? []) as Record<string, string>[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Monta o plano de uma junção. `gssPairs` são os pares em id do GSS; os mapas
 * `*ByGss` traduzem para uuid local, e `*HasGss` diz quais uuids são geridos pelo
 * GSS (usado só para decidir o que pode ser apagado). Puro — não escreve.
 */
export function planJunction(
  table: JunctionTable,
  parentCol: string,
  childCol: string,
  gssPairs: { parentGss: string; childGss: string }[],
  current: Record<string, string>[],
  parentByGss: Map<string, string>,
  childByGss: Map<string, string>,
  parentHasGss: Set<string>,
  childHasGss: Set<string>,
  opts: SyncOptions
): JunctionPlan {
  const key = (p: string, c: string) => `${p}|${c}`;
  const currentSet = new Set(current.map((r) => key(r[parentCol], r[childCol])));

  const desired = new Set<string>();
  let unresolved = 0;
  for (const { parentGss, childGss } of gssPairs) {
    const p = parentByGss.get(parentGss);
    const c = childByGss.get(childGss);
    if (!p || !c) {
      unresolved++;
      continue;
    }
    desired.add(key(p, c));
  }

  const inserts: Record<string, string>[] = [];
  let matched = 0;
  for (const k of desired) {
    if (currentSet.has(k)) {
      matched++;
      continue;
    }
    const [p, c] = k.split("|");
    inserts.push({ [parentCol]: p, [childCol]: c });
  }

  // Só entra em `deletes` o vínculo cujos DOIS lados são geridos pelo GSS. Se um
  // lado é local-only (sem `gss_id`), o vínculo é nosso — o GSS não o conhece e
  // não pode "sumir" com ele.
  const deletes: Record<string, string>[] = [];
  for (const r of current) {
    if (desired.has(key(r[parentCol], r[childCol]))) continue;
    if (!parentHasGss.has(r[parentCol]) || !childHasGss.has(r[childCol])) continue;
    deletes.push({ [parentCol]: r[parentCol], [childCol]: r[childCol] });
  }

  return {
    table, parentCol, childCol, inserts, deletes, matched,
    desired: desired.size,
    current: currentSet.size,
    unresolved,
    appliedDeletes: opts.softDelete,
  };
}

/** Grava a junção. Insert por padrão; delete só com `softDelete`. */
async function applyJunction(sb: DB, plan: JunctionPlan, opts: SyncOptions): Promise<void> {
  if (!opts.commit || opts.pairOnly) return; // pairOnly é só o pass de gss_id
  const t = () => looseJ(sb, plan.table);

  const B = 500;
  for (let i = 0; i < plan.inserts.length; i += B) {
    const { error } = await t().insert(plan.inserts.slice(i, i + B));
    if (error) throw new Error(`insert ${plan.table} [${i}..]: ${error.message}`);
  }

  if (opts.softDelete && plan.deletes.length) {
    const CH = 25;
    for (let i = 0; i < plan.deletes.length; i += CH) {
      await Promise.all(plan.deletes.slice(i, i + CH).map(async (d) => {
        const { error } = await t().delete().eq(plan.parentCol, d[plan.parentCol]).eq(plan.childCol, d[plan.childCol]);
        if (error) throw new Error(`delete ${plan.table} ${d[plan.parentCol]}/${d[plan.childCol]}: ${error.message}`);
      }));
    }
  }
}

async function recordJunctionState(sb: DB, plan: JunctionPlan, opts: SyncOptions, error?: string): Promise<void> {
  if (!opts.commit || opts.pairOnly) return;
  const { error: e } = await sb.from("gss_sync_state").upsert(
    {
      resource: plan.table,
      last_run_at: new Date().toISOString(),
      last_status: error ? "error" : "ok",
      last_error: error ?? null,
      rows_upserted: plan.inserts.length,
      rows_deleted: opts.softDelete ? plan.deletes.length : 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "resource" }
  );
  if (e) console.warn(`gss_sync_state ${plan.table}: ${e.message}`);
}

/**
 * Executa o sync inteiro, na ordem de FK do §4.3 (countries primeiro, porque
 * `clients.country_id` depende do mapa dele). Recursos primeiro, junções depois —
 * a junção precisa dos `gss_id` de fábricas e categorias já gravados.
 */
export async function runSync(
  sb: DB,
  options: Partial<SyncOptions> = {}
): Promise<{ resources: ResourcePlan[]; junctions: JunctionPlan[] }> {
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

  // 5) agents e carriers — pareiam por nome, com o e-mail como confirmação.
  // O cadastro deles é semente (1 registro cada), então os campos só preenchem
  // o que está vazio aqui: `fillOnly`.
  await run(planResource("agents", await loadLocal(sb, "agents"), await fetchGss<GssAgent>(GSS_ENDPOINTS.agent),
    (a) => a.name, (a) => a.id,
    (a) => ({
      name: a.name,
      email: a.email,
      country_id: a.country != null ? countryMap.get(String(a.country)) ?? null : null,
      location: norm(a.country_name) === "china" ? "china" : norm(a.country_name) === "brazil" ? "brazil" : null,
    }),
    opts,
    { gss: (a) => a.email, local: "email" },
    new Set(["email", "country_id", "location"])));

  await run(planResource("carriers", await loadLocal(sb, "carriers"), await fetchGss<GssCarrier>(GSS_ENDPOINTS.carrier),
    (c) => c.name, (c) => c.id, (c) => ({ name: c.name }), opts));

  // 6) categories ← supplier-category (a category distinta, não a junção)
  const sc = await fetchGss<GssSupplierCategory>(GSS_ENDPOINTS.supplierCategory);
  const catById = new Map<number, string>();
  for (const row of sc) if (!catById.has(row.category)) catById.set(row.category, row.category_name);
  const cats = [...catById.entries()].map(([id, name]) => ({ id, name }));
  await run(planResource("categories", await loadLocal(sb, "categories"), cats,
    (c) => c.name, (c) => c.id, (c) => ({ name: c.name }), opts));

  // 7) category_factories ← supplier-category (a JUNÇÃO Factory × Category).
  // Reusa `sc`: cada linha carrega `supplier`+`category` (o par). Relê os mapas
  // depois dos applies acima, para enxergar fábricas/categorias recém-pareadas.
  const junctions: JunctionPlan[] = [];
  {
    const catRows = await loadLocal(sb, "categories");
    const facRows = await loadLocal(sb, "factories");
    const catByGss = new Map<string, string>();
    const catHasGss = new Set<string>();
    for (const r of catRows) if (r.deleted_at === null && r.gss_id) { catByGss.set(r.gss_id, r.id); catHasGss.add(r.id); }
    const facByGss = new Map<string, string>();
    const facHasGss = new Set<string>();
    for (const r of facRows) if (r.deleted_at === null && r.gss_id) { facByGss.set(r.gss_id, r.id); facHasGss.add(r.id); }

    const gssPairs = sc.map((row) => ({ parentGss: String(row.category), childGss: String(row.supplier) }));
    const current = await loadJunction(sb, "category_factories", "category_id", "factory_id");
    const jp = planJunction(
      "category_factories", "category_id", "factory_id",
      gssPairs, current, catByGss, facByGss, catHasGss, facHasGss, opts
    );
    try {
      await applyJunction(sb, jp, opts);
      await recordJunctionState(sb, jp, opts);
    } catch (err) {
      await recordJunctionState(sb, jp, opts, err instanceof Error ? err.message : String(err));
      throw err;
    }
    junctions.push(jp);
  }

  return { resources: plans, junctions };
}
