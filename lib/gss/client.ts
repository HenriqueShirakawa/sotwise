/**
 * Cliente de LEITURA da API do GSS / AGK-Core (Django REST em api.gssdatahub.com).
 *
 * Server-side apenas (lê segredos de process.env). NÃO tem `import "server-only"`
 * de propósito: este módulo é reusado tanto pela rota do CRON (app/api/cron/…)
 * quanto pelos scripts tsx (scripts/sync-gss/…) — o guard `server-only` lança em
 * ambiente de script. Mesmo padrão de `scripts/migrate/client.ts`. Nunca importar
 * em código de client/browser.
 *
 * Duas camadas de autenticação (ver docs/INTEGRACAO_GSS.md e o guia da AGK):
 *   1. Cloudflare Access — headers de service token em TODA requisição.
 *   2. JWT do AGK-Core — obtido por login (username/senha), enviado como Bearer.
 *      O access token é curto; guardamos em cache e renovamos sob demanda.
 *
 * Env (server-only, nunca NEXT_PUBLIC_):
 *   GSS_API_BASE                 default https://api.gssdatahub.com/v1
 *   GSS_CF_ACCESS_CLIENT_ID      header CF-Access-Client-Id
 *   GSS_CF_ACCESS_CLIENT_SECRET  header CF-Access-Client-Secret
 *   GSS_USERNAME / GSS_PASSWORD  credenciais do usuário técnico
 *
 * Realidade da API confirmada em 2026-08-14: sem paginação (a lista inteira volta
 * num array), sem filtro server-side por updated_at, ids inteiros, FKs como
 * `<campo>` (id) + `<campo>_name` de conveniência. Ver docs/INTEGRACAO_GSS.md.
 */

const DEFAULT_BASE = "https://api.gssdatahub.com/v1";

export type GssResult<T> = { ok: true; data: T } | { ok: false; error: string };

type TokenPair = { access: string; refresh: string };

// ---- configuração (lida preguiçosamente, nunca no import) ------------------
function readConfig():
  | { ok: true; base: string; cfId: string; cfSecret: string; username: string; password: string }
  | { ok: false; error: string } {
  const base = (process.env.GSS_API_BASE || DEFAULT_BASE).replace(/\/+$/, "");
  const cfId = process.env.GSS_CF_ACCESS_CLIENT_ID;
  const cfSecret = process.env.GSS_CF_ACCESS_CLIENT_SECRET;
  const username = process.env.GSS_USERNAME;
  const password = process.env.GSS_PASSWORD;
  if (!cfId || !cfSecret || !username || !password) {
    // Diagnóstico: nomear QUAIS faltam no runtime (nunca o valor). Se faltam
    // todas → variáveis no projeto/ambiente errado; se falta só uma → typo na chave.
    const entradas: [string, string | undefined][] = [
      ["GSS_CF_ACCESS_CLIENT_ID", cfId],
      ["GSS_CF_ACCESS_CLIENT_SECRET", cfSecret],
      ["GSS_USERNAME", username],
      ["GSS_PASSWORD", password],
    ];
    const faltando = entradas.filter(([, v]) => !v).map(([k]) => k);
    return {
      ok: false,
      error: `Credenciais do GSS ausentes no runtime: ${faltando.join(", ")}. Confira Environment Variables → Production no projeto certo (o que serve este domínio).`,
    };
  }
  return { ok: true, base, cfId, cfSecret, username, password };
}

function cfHeaders(cfId: string, cfSecret: string): Record<string, string> {
  return { "CF-Access-Client-Id": cfId, "CF-Access-Client-Secret": cfSecret };
}

/** `exp` (epoch s) do payload de um JWT, sem validar assinatura. 0 se ilegível. */
function jwtExp(token: string): number {
  try {
    const payload = token.split(".")[1];
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const exp = (JSON.parse(json) as { exp?: number }).exp;
    return typeof exp === "number" ? exp : 0;
  } catch {
    return 0;
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- cache de token (por processo) -----------------------------------------
let cachedAccess: string | null = null;
let cachedAccessExp = 0; // epoch s
let cachedRefresh: string | null = null;
const EXP_MARGIN_S = 30; // renova um pouco antes de expirar

function tokenStillValid(): boolean {
  return !!cachedAccess && Date.now() / 1000 < cachedAccessExp - EXP_MARGIN_S;
}

function storeTokens(pair: TokenPair): void {
  cachedAccess = pair.access;
  cachedAccessExp = jwtExp(pair.access);
  cachedRefresh = pair.refresh;
}

async function login(cfg: Extract<ReturnType<typeof readConfig>, { ok: true }>): Promise<GssResult<TokenPair>> {
  let res: Response;
  try {
    res = await fetch(`${cfg.base}/authentication/token/`, {
      method: "POST",
      headers: { ...cfHeaders(cfg.cfId, cfg.cfSecret), "Content-Type": "application/json" },
      body: JSON.stringify({ username: cfg.username, password: cfg.password }),
    });
  } catch (cause) {
    return { ok: false, error: `Falha de rede no login do GSS: ${String(cause)}` };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, error: `Login GSS ${res.status}: ${detail.slice(0, 200)}` };
  }
  const pair = (await res.json().catch(() => null)) as TokenPair | null;
  if (!pair?.access) return { ok: false, error: "Login GSS: resposta sem `access`." };
  return { ok: true, data: pair };
}

async function refresh(
  cfg: Extract<ReturnType<typeof readConfig>, { ok: true }>,
  refreshToken: string
): Promise<GssResult<string>> {
  let res: Response;
  try {
    res = await fetch(`${cfg.base}/authentication/token/refresh/`, {
      method: "POST",
      headers: { ...cfHeaders(cfg.cfId, cfg.cfSecret), "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: refreshToken }),
    });
  } catch (cause) {
    return { ok: false, error: `Falha de rede no refresh do GSS: ${String(cause)}` };
  }
  if (!res.ok) return { ok: false, error: `Refresh GSS ${res.status}` };
  const body = (await res.json().catch(() => null)) as { access?: string } | null;
  if (!body?.access) return { ok: false, error: "Refresh GSS: resposta sem `access`." };
  return { ok: true, data: body.access };
}

/** Garante um access token válido em cache (refresh → login como fallback). */
async function ensureAccessToken(
  cfg: Extract<ReturnType<typeof readConfig>, { ok: true }>
): Promise<GssResult<string>> {
  if (tokenStillValid()) return { ok: true, data: cachedAccess! };

  if (cachedRefresh) {
    const r = await refresh(cfg, cachedRefresh);
    if (r.ok) {
      cachedAccess = r.data;
      cachedAccessExp = jwtExp(r.data);
      return { ok: true, data: r.data };
    }
    // refresh expirado/inválido → cai para login completo.
  }

  const l = await login(cfg);
  if (!l.ok) return l;
  storeTokens(l.data);
  return { ok: true, data: l.data.access };
}

/**
 * Espera antes de cada nova tentativa de leitura. O GSS cai em rajadas (502/530
 * "Cloudflare Tunnel error") que duram segundos, não milissegundos — com 0,5–2 s
 * as 4 tentativas acabavam dentro da mesma rajada. Só o sync usa `gssGet`, sem
 * usuário esperando, e cada cron tem 300 s.
 */
const READ_RETRY_MS = [2_000, 5_000, 10_000];

/**
 * Espera pedida por um login 429 do GSS ("Expected available in 24 seconds"),
 * em ms, com folga de 1 s e teto de 65 s. `null` = não é estrangulamento.
 */
function loginThrottleWait(error: string): number | null {
  if (!error.startsWith("Login GSS 429")) return null;
  const s = Number(/available in (\d+) second/.exec(error)?.[1] ?? 30);
  return Math.min(s + 1, 65) * 1000;
}

/**
 * GET autenticado num recurso do GSS. `path` é relativo à base, ex.:
 * "/core/country/". Retenta em 429/5xx/rede com espera crescente (`READ_RETRY_MS`);
 * em 401 renova o token e repete 1x.
 */
export async function gssGet<T = unknown>(path: string): Promise<GssResult<T>> {
  const cfg = readConfig();
  if (!cfg.ok) return cfg;

  const url = `${cfg.base}${path.startsWith("/") ? path : `/${path}`}`;

  for (let attempt = 0; attempt < 4; attempt++) {
    const tok = await ensureAccessToken(cfg);
    if (!tok.ok) {
      // Login estrangulado (429) diz quanto esperar; espera e tenta de novo, em
      // vez de perder a leitura — com um cron por biblioteca, cada um faz login.
      const wait = loginThrottleWait(tok.error);
      if (wait !== null && attempt < 3) {
        await sleep(wait);
        continue;
      }
      return tok;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { ...cfHeaders(cfg.cfId, cfg.cfSecret), Authorization: `Bearer ${tok.data}` },
      });
    } catch (cause) {
      if (attempt < 3) {
        await sleep(READ_RETRY_MS[attempt]);
        continue;
      }
      return { ok: false, error: `Falha de rede no GET ${path}: ${String(cause)}` };
    }

    if (res.status === 401) {
      // Token pode ter sido revogado; invalida o cache e tenta de novo.
      cachedAccess = null;
      cachedAccessExp = 0;
      cachedRefresh = null;
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt < 3) await sleep(READ_RETRY_MS[attempt]);
      continue;
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `GSS ${res.status} em ${path}: ${detail.slice(0, 200)}` };
    }

    const data = (await res.json().catch(() => null)) as T | null;
    if (data === null) return { ok: false, error: `GSS ${path}: corpo não-JSON.` };
    return { ok: true, data };
  }

  return { ok: false, error: `GSS ${path}: esgotou as tentativas.` };
}

/**
 * Como a fila de saída (lib/gss/outbound) trata o resultado de uma escrita:
 *   - `ok`        2xx;
 *   - `blocked`   challenge do Cloudflare ou credencial ausente no runtime —
 *                 não é culpa do dado, tenta depois sem gastar tentativa;
 *   - `retryable` rede, timeout, login falhou, 429, 5xx (o GSS já devolveu 502
 *                 no login);
 *   - `permanent` demais 4xx (400 de campo, 403 de permissão, 404, 409 de
 *                 regra) — repetir igual não muda nada.
 */
export type GssWriteKind = "ok" | "blocked" | "retryable" | "permanent";

export type GssWriteResult = {
  kind: GssWriteKind;
  /** 0 quando não houve resposta (rede/timeout/credencial ausente). */
  status: number;
  data: unknown;
  /** Corpo cru (truncado), para log e auditoria. */
  text: string;
  error?: string;
};

const WRITE_TIMEOUT_MS = 15_000;
const BODY_LOG_MAX = 2000;

function isCloudflareChallenge(res: Response, text: string): boolean {
  if (res.headers.get("cf-mitigated") === "challenge") return true;
  return /<title>\s*Just a moment/i.test(text);
}

/** Quem fez a chamada — vai para o log (`gss_call_log.source` / `.ref`). */
export type GssCallContext = { source?: string; ref?: string };

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

// ---- log de chamadas (gss_call_log, migration 20261019120000) ---------------
// Cada `gssRequest` vira uma linha, para os erros dos envios em `after()` não
// sumirem no log da Vercel (pedido do usuário, 19/10/2026). Grava direto pelo
// PostgREST com o service role — funciona no app e nos scripts. Se a tabela
// não existir (migration não aplicada) ou o insert falhar, avisa UMA vez e
// segue: o log nunca derruba um envio.
let callLogDisabled = false;

async function logGssCall(row: {
  method: HttpMethod;
  path: string;
  status: number;
  kind: GssWriteKind;
  duration_ms: number;
  request_body: unknown;
  response_body: string;
  error: string | null;
  source: string | null;
  ref: string | null;
}): Promise<void> {
  if (callLogDisabled) return;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/gss_call_log`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        ...row,
        request_body: row.request_body === undefined ? null : row.request_body,
        origin: process.env.VERCEL ? "app" : "script",
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      callLogDisabled = true;
      console.warn(`[gss-log] log desligado neste processo: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
  } catch (err) {
    callLogDisabled = true;
    console.warn("[gss-log] log desligado neste processo:", err);
  }
}

/**
 * Requisição autenticada de ESCRITA no GSS. Diferente de `gssGet`, não repete
 * 429/5xx aqui dentro: quem decide quando tentar de novo é a fila (backoff entre
 * disparos). Só renova o token num 401 e repete 1x. Toda chamada vai para o
 * `gss_call_log` (tela /access/gss/calls).
 */
export async function gssRequest(
  method: HttpMethod,
  path: string,
  body?: unknown,
  ctx: GssCallContext = {}
): Promise<GssWriteResult> {
  const started = Date.now();
  const result = await gssRequestRaw(method, path, body);
  await logGssCall({
    method,
    path,
    status: result.status,
    kind: result.kind,
    duration_ms: Date.now() - started,
    request_body: body,
    response_body: result.text,
    error: result.error ?? null,
    source: ctx.source ?? null,
    ref: ctx.ref ?? null,
  });
  return result;
}

async function gssRequestRaw(method: HttpMethod, path: string, body?: unknown): Promise<GssWriteResult> {
  const cfg = readConfig();
  if (!cfg.ok) return { kind: "blocked", status: 0, data: null, text: "", error: cfg.error };

  const url = `${cfg.base}${path.startsWith("/") ? path : `/${path}`}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const tok = await ensureAccessToken(cfg);
    if (!tok.ok) return { kind: "retryable", status: 0, data: null, text: "", error: tok.error };

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          ...cfHeaders(cfg.cfId, cfg.cfSecret),
          Authorization: `Bearer ${tok.data}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
      });
    } catch (cause) {
      return { kind: "retryable", status: 0, data: null, text: "", error: `Falha de rede em ${method} ${path}: ${String(cause)}` };
    }

    if (res.status === 401 && attempt === 0) {
      // Token pode ter sido revogado; invalida o cache e tenta de novo.
      cachedAccess = null;
      cachedAccessExp = 0;
      cachedRefresh = null;
      continue;
    }

    const text = await res.text().catch(() => "");
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // corpo não-JSON (HTML do Cloudflare, por exemplo)
    }
    const logText = text.slice(0, BODY_LOG_MAX);

    if (isCloudflareChallenge(res, text)) {
      return { kind: "blocked", status: res.status, data: null, text: logText, error: `Cloudflare challenge em ${method} ${path}` };
    }
    if (res.ok) return { kind: "ok", status: res.status, data, text: logText };
    if (res.status === 429 || res.status >= 500) {
      return { kind: "retryable", status: res.status, data, text: logText, error: `GSS ${res.status} em ${method} ${path}` };
    }
    return { kind: "permanent", status: res.status, data, text: logText, error: `GSS ${res.status} em ${method} ${path}: ${logText.slice(0, 300)}` };
  }

  return { kind: "retryable", status: 401, data: null, text: "", error: `GSS 401 em ${method} ${path} mesmo após renovar o token.` };
}

// ---- tipos dos recursos usados (confirmados em 2026-08-14) -----------------
// Todos trazem `id` inteiro. `updated_at`/`created_at` em ISO. FKs = id inteiro
// + `<campo>_name` de conveniência. `supplier` é a exceção: sem timestamps.

type IsoDate = string;

/**
 * `is_active` apareceu em `country` e `city` (conferido ao vivo em 2026-10-14) —
 * é a mesma marca que a nossa coluna `is_active` (20261013130000) e o espelho de
 * geografia a traz. Os outros recursos daqui ainda não têm o campo.
 */
export type GssCountry = { id: number; name: string; iso_code: string | null; is_active?: boolean; created_at: IsoDate; updated_at: IsoDate };
export type GssProvince = { id: number; name: string; country: number; country_name: string; created_at: IsoDate; updated_at: IsoDate };
export type GssCity = { id: number; name: string; province: number; province_name: string | null; country_name: string | null; is_active?: boolean; created_at: IsoDate; updated_at: IsoDate };
export type GssPort = { id: number; name: string; city: number; city_name: string; province_name: string; country_name: string; created_at: IsoDate; updated_at: IsoDate };
export type GssCustomer = {
  id: number;
  name: string;
  country: number | null;
  country_name: string | null;
  payment_condition: unknown;
  importer_ids: number[];
  consignee_ids: number[];
  created_at: IsoDate;
  updated_at: IsoDate;
};
export type GssCompany = {
  id: number;
  name: string;
  short_name: string | null;
  country_name: string | null;
  province_name: string | null;
  city_name: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  logo: string | null;
  address: string | null;
  company_id: string | null;
  is_importer: boolean;
  is_consignee: boolean;
  created_at: IsoDate;
  updated_at: IsoDate;
};
export type GssSupplier = { id: number; company: number; company_name: string; is_obsolete: boolean; obsolete_justification: string };
export type GssSupplierCategory = {
  id: number;
  supplier: number;
  supplier_name: string;
  category: number;
  category_name: string;
  city: number | null;
  city_name: string | null;
  code: string | null;
  created_at: IsoDate;
  updated_at: IsoDate;
};
export type GssExporter = { id: number; name: string; code: string; country: number | null; country_name: string | null; company: number | null; company_name: string | null; created_at: IsoDate; updated_at: IsoDate };
/**
 * `agent` e `carrier` EXISTEM na API (confirmado em 2026-08-14), ao contrário do
 * que o ERD de MAPEAMENTO_GSS indicava. Em compensação estão praticamente
 * vazios: 1 registro cada, de aparência semente (`asiashipping@as.com`,
 * `msc@msc.com`, ambos criados em 12/11/2025). `carrier` não tem país.
 */
export type GssAgent = { id: number; name: string; email: string | null; address: string | null; country: number | null; country_name: string | null; created_at: IsoDate; updated_at: IsoDate };
export type GssCarrier = { id: number; name: string; email: string | null; address: string | null; created_at: IsoDate; updated_at: IsoDate };
export type GssOrderType = { id: number; name: string; description: string | null; created_at: IsoDate; updated_at: IsoDate };
export type GssBusinessUnit = { id: number; name: string; description: string | null; icon: string | null; created_at: IsoDate; updated_at: IsoDate };

/** Endpoints (relativos à base /v1) das libs que o GSS é fonte. */
export const GSS_ENDPOINTS = {
  country: "/core/country/",
  province: "/core/province/",
  city: "/core/city/",
  port: "/core/port/",
  customer: "/core/customer/",
  company: "/core/company/",
  supplier: "/core/supplier/",
  supplierCategory: "/core/supplier-category/",
  exporter: "/core/exporter/",
  orderType: "/core/order-type/",
  businessUnit: "/core/business-unit/",
  agent: "/core/agent/",
  carrier: "/core/carrier/",
} as const;
