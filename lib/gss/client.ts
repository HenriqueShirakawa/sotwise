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
 * GET autenticado num recurso do GSS. `path` é relativo à base, ex.:
 * "/core/country/". Retenta em 429/5xx; em 401 renova o token e repete 1x.
 */
export async function gssGet<T = unknown>(path: string): Promise<GssResult<T>> {
  const cfg = readConfig();
  if (!cfg.ok) return cfg;

  const url = `${cfg.base}${path.startsWith("/") ? path : `/${path}`}`;

  for (let attempt = 0; attempt < 4; attempt++) {
    const tok = await ensureAccessToken(cfg);
    if (!tok.ok) return tok;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { ...cfHeaders(cfg.cfId, cfg.cfSecret), Authorization: `Bearer ${tok.data}` },
      });
    } catch (cause) {
      if (attempt < 3) {
        await sleep(400 * (attempt + 1));
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
      await sleep(500 * (attempt + 1));
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

// ---- tipos dos recursos usados (confirmados em 2026-08-14) -----------------
// Todos trazem `id` inteiro. `updated_at`/`created_at` em ISO. FKs = id inteiro
// + `<campo>_name` de conveniência. `supplier` é a exceção: sem timestamps.

type IsoDate = string;

export type GssCountry = { id: number; name: string; iso_code: string | null; created_at: IsoDate; updated_at: IsoDate };
export type GssProvince = { id: number; name: string; country: number; country_name: string; created_at: IsoDate; updated_at: IsoDate };
export type GssCity = { id: number; name: string; province: number; province_name: string; country_name: string; created_at: IsoDate; updated_at: IsoDate };
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
