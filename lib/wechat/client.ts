import "server-only";

/**
 * Cliente da API da Service Account (服务号) do WeChat — a conta oficial da
 * empresa que a equipe SEGUE no WeChat normal (sem instalar outro app).
 *
 * IP FIXO: a Service Account só entrega access_token a IPs da "IP白名单", e a
 * Vercel não tem IP de saída fixo. Com `WECHAT_RELAY_URL` definido, toda
 * chamada passa pelo relay (relay/wechat/), num servidor de IP fixo. Sem relay,
 * chama direto (serve para o 测试号, que não tem lista de IP).
 *
 * Envs (todas server-side, nunca NEXT_PUBLIC_):
 *   WECHAT_APP_ID, WECHAT_APP_SECRET           — 开发 → 基本配置
 *   WECHAT_TOKEN, WECHAT_AES_KEY               — 服务器配置 (AES só no modo seguro)
 *   WECHAT_TEMPLATE_ID, WECHAT_TEMPLATE_FIELDS — aviso fora da janela de 48h
 *   WECHAT_RELAY_URL, WECHAT_RELAY_SECRET      — o relay (opcional)
 *   WECHAT_DISABLED=true                       — desliga sem deploy
 */

const API_BASE = "https://api.weixin.qq.com";
const TIMEOUT_MS = 8_000;

export type WechatConfig = {
  appId: string;
  secret: string;
};

/** null = WeChat não configurado (ou desligado) — quem chama simplesmente não faz nada. */
export function wechatConfig(): WechatConfig | null {
  if (process.env.WECHAT_DISABLED === "true") return null;
  const appId = process.env.WECHAT_APP_ID;
  const secret = process.env.WECHAT_APP_SECRET;
  if (!appId || !secret) return null;
  return { appId, secret };
}

type WechatResponse = { errcode?: number; errmsg?: string; [key: string]: unknown };

async function call(
  method: "GET" | "POST",
  path: string,
  query: Record<string, string>,
  body?: unknown
): Promise<WechatResponse> {
  const relay = process.env.WECHAT_RELAY_URL;
  const signal = AbortSignal.timeout(TIMEOUT_MS);

  const res = relay
    ? await fetch(`${relay.replace(/\/$/, "")}/proxy`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WECHAT_RELAY_SECRET ?? ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ method, path, query, body }),
        signal,
      })
    : await fetch(`${API_BASE}${path}?${new URLSearchParams(query)}`, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });

  const text = await res.text();
  if (!res.ok) throw new Error(`WeChat HTTP ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as WechatResponse;
  } catch {
    throw new Error(`WeChat: non-JSON response: ${text.slice(0, 300)}`);
  }
}

// access_token vale 7200s. Cache por instância da função; renova 5 min antes.
// `stable_token` devolve o MESMO token enquanto ele vale: várias instâncias da
// Vercel pedindo ao mesmo tempo não derrubam o token umas das outras (o
// `/cgi-bin/token` antigo derrubava).
let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(cfg: WechatConfig, force = false): Promise<string> {
  if (!force && cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  const res = await call("POST", "/cgi-bin/stable_token", {}, {
    grant_type: "client_credential",
    appid: cfg.appId,
    secret: cfg.secret,
    force_refresh: force,
  });
  if (res.errcode || typeof res.access_token !== "string") {
    throw new Error(`WeChat stable_token ${res.errcode}: ${res.errmsg}`);
  }
  const ttl = typeof res.expires_in === "number" ? res.expires_in : 7200;
  cachedToken = { value: res.access_token, expiresAt: Date.now() + (ttl - 300) * 1000 };
  return cachedToken.value;
}

/** Token inválido/expirado: o WeChat pode invalidar antes do prazo. */
const TOKEN_ERRORS = new Set([40001, 40014, 42001]);

async function authedPost(cfg: WechatConfig, path: string, body: unknown): Promise<WechatResponse> {
  let res = await call("POST", path, { access_token: await accessToken(cfg) }, body);
  if (res.errcode && TOKEN_ERRORS.has(res.errcode)) {
    res = await call("POST", path, { access_token: await accessToken(cfg, true) }, body);
  }
  return res;
}

export type WechatSendResult =
  | { ok: true; msgid: string | null }
  | { ok: false; errcode: number | null; error: string };

async function send(cfg: WechatConfig, path: string, body: unknown): Promise<WechatSendResult> {
  try {
    const res = await authedPost(cfg, path, body);
    if (res.errcode) return { ok: false, errcode: res.errcode, error: `${res.errcode}: ${res.errmsg}` };
    return { ok: true, msgid: res.msgid == null ? null : String(res.msgid) };
  } catch (error) {
    return { ok: false, errcode: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Fora da janela de 48h desde a última interação da pessoa com a conta, o
 * WeChat recusa texto livre: 45015 (fora do prazo) ou 45047 (passou do limite
 * de mensagens sem resposta). Aí o aviso vai por template.
 */
export const OUT_OF_WINDOW = new Set([45015, 45047]);

/**
 * Mensagem de atendimento (客服消息): texto livre, um destinatário por chamada.
 * `content` aceita `<a href="...">`. Só vale dentro da janela de 48h.
 */
export function sendCustomText(cfg: WechatConfig, openId: string, content: string): Promise<WechatSendResult> {
  return send(cfg, "/cgi-bin/message/custom/send", {
    touser: openId,
    msgtype: "text",
    text: { content },
  });
}

/** Mensagem de template (模板消息): chega a qualquer hora, mas só com os campos do template. */
export function sendTemplate(
  cfg: WechatConfig,
  openId: string,
  templateId: string,
  url: string | undefined,
  data: Record<string, string>
): Promise<WechatSendResult> {
  return send(cfg, "/cgi-bin/message/template/send", {
    touser: openId,
    template_id: templateId,
    ...(url ? { url } : {}),
    data: Object.fromEntries(Object.entries(data).map(([k, value]) => [k, { value }])),
  });
}

/**
 * QR temporário com parâmetro (带参数二维码). Quem escaneia com o WeChat cai na
 * conta; o callback traz o `scene` no EventKey (subscribe → "qrscene_<scene>",
 * quem já segue → SCAN com "<scene>"). Devolve o endereço da imagem.
 */
export async function createSceneQr(
  cfg: WechatConfig,
  scene: string,
  expireSeconds: number
): Promise<{ ok: true; imageUrl: string } | { ok: false; error: string }> {
  try {
    const res = await authedPost(cfg, "/cgi-bin/qrcode/create", {
      expire_seconds: expireSeconds,
      action_name: "QR_STR_SCENE",
      action_info: { scene: { scene_str: scene } },
    });
    if (res.errcode || typeof res.ticket !== "string") {
      return { ok: false, error: `${res.errcode}: ${res.errmsg}` };
    }
    return {
      ok: true,
      imageUrl: `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${encodeURIComponent(res.ticket)}`,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
