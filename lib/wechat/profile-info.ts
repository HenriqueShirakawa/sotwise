import "server-only";

import { createHash } from "node:crypto";

import { userInfoAuthUrl, type WechatConfig } from "./client";
import { linkBase } from "./notify";

/**
 * Impressão curta do OpenID para a tela (que não precisa ver o OpenID): muda
 * quando OUTRO WeChat é vinculado — é assim que "Link another WeChat" percebe
 * a troca sem confundir com o vínculo que já existia. Null = não vinculado.
 */
export function wechatRef(openId: string | null): string | null {
  return openId ? createHash("sha256").update(openId).digest("hex").slice(0, 12) : null;
}

/** Rota que recebe a volta da autorização de página (app/api/wechat/oauth). */
export const OAUTH_PATH = "/api/wechat/oauth";

/**
 * Texto (com link) que o robô manda para a pessoa autorizar nome e foto. Null
 * quando não há base de link (sem WECHAT_LINK_BASE_URL nem origin).
 */
export function shareInfoText(cfg: WechatConfig, origin?: string): string | null {
  const base = linkBase(origin);
  if (!base) return null;
  const url = userInfoAuthUrl(cfg, `${base}${OAUTH_PATH}`);
  return (
    `To show your WeChat name and photo in SOT, <a href="${url}">tap here</a> and allow.\n` +
    `点击<a href="${url}">这里</a>并允许,即可在 SOT 显示你的微信昵称和头像。`
  );
}
