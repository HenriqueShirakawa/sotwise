import "server-only";

import { wechatCall } from "@/lib/wechat/client";

/**
 * Cliente do Mini Program (小程序) do WeChat — fase 2 (16/11/2026, docs §6.17):
 * o contato da FÁBRICA responde ETD / atraso / Ready parts por ele.
 *
 * É outra conta do WeChat (AppID próprio), separada da Service Account da fase
 * 1: o OpenID da mesma pessoa é DIFERENTE em cada uma. As chamadas passam pelo
 * mesmo relay de IP fixo da fase 1, quando houver (`WECHAT_RELAY_URL`).
 *
 * Envs (server-side):
 *   WECHAT_MP_APP_ID, WECHAT_MP_APP_SECRET — 开发管理 → 开发设置 (ou o 测试号)
 *   WECHAT_MP_SESSION_SECRET               — assina a sessão do Mini Program
 *                                            (sem ela, usa o AppSecret)
 *   WECHAT_MP_ENV_VERSION                  — develop | trial | release (QR do
 *                                            convite; padrão "release")
 *   WECHAT_MP_DISABLED=true                — desliga sem deploy
 */

export type MpConfig = { appId: string; secret: string; sessionSecret: string };

/** null = Mini Program não configurado (ou desligado). */
export function mpConfig(): MpConfig | null {
  if (process.env.WECHAT_MP_DISABLED === "true") return null;
  const appId = process.env.WECHAT_MP_APP_ID;
  const secret = process.env.WECHAT_MP_APP_SECRET;
  if (!appId || !secret) return null;
  return { appId, secret, sessionSecret: process.env.WECHAT_MP_SESSION_SECRET || secret };
}

/**
 * `wx.login()` no celular → `code` (vale 5 min, uso único) → aqui vira o OpenID
 * da pessoa neste Mini Program. É a única prova de identidade que o Mini
 * Program dá; nada que o celular mande além disso é confiável.
 */
export async function codeToSession(
  cfg: MpConfig,
  code: string
): Promise<{ ok: true; openId: string; unionId: string | null } | { ok: false; error: string }> {
  try {
    const res = await wechatCall("GET", "/sns/jscode2session", {
      appid: cfg.appId,
      secret: cfg.secret,
      js_code: code,
      grant_type: "authorization_code",
    });
    if (res.errcode || typeof res.openid !== "string") {
      return { ok: false, error: `${res.errcode}: ${res.errmsg}` };
    }
    return {
      ok: true,
      openId: res.openid,
      unionId: typeof res.unionid === "string" ? res.unionid : null,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(cfg: MpConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  const res = await wechatCall("POST", "/cgi-bin/stable_token", {}, {
    grant_type: "client_credential",
    appid: cfg.appId,
    secret: cfg.secret,
  });
  if (res.errcode || typeof res.access_token !== "string") {
    throw new Error(`WeChat stable_token ${res.errcode}: ${res.errmsg}`);
  }
  const ttl = typeof res.expires_in === "number" ? res.expires_in : 7200;
  cachedToken = { value: res.access_token, expiresAt: Date.now() + (ttl - 300) * 1000 };
  return cachedToken.value;
}

const ENV_VERSIONS = new Set(["develop", "trial", "release"]);

/**
 * Código do Mini Program (小程序码) com `scene` — quem escaneia com o WeChat
 * abre direto a página de vínculo com o convite preenchido. Devolve a imagem
 * como data URL. Pode falhar no 测试号 ou antes de publicar: aí a tela mostra só
 * o código para digitar.
 *
 * Direto, sem relay: a resposta é binária (PNG) e o relay só devolve JSON.
 */
export async function inviteQrDataUrl(
  cfg: MpConfig,
  scene: string
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  try {
    const envVersion = process.env.WECHAT_MP_ENV_VERSION ?? "release";
    const res = await fetch(
      `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(await accessToken(cfg))}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scene,
          page: "pages/bind/index",
          check_path: false,
          env_version: ENV_VERSIONS.has(envVersion) ? envVersion : "release",
          width: 280,
        }),
        signal: AbortSignal.timeout(8_000),
      }
    );
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) {
      return { ok: false, error: (await res.text()).slice(0, 300) };
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    return { ok: true, dataUrl: `data:${type};base64,${bytes.toString("base64")}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
