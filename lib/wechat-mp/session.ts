import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Sessão do Mini Program e código de convite — funções puras (sem
 * `server-only`), cobertas por scripts/wechat-mp-selftest.ts.
 *
 * Sessão = "<payload base64url>.<hmac>" com o OpenID e o vencimento. O
 * Mini Program guarda e manda em `Authorization: Bearer ...`. Sem banco: quem
 * a pessoa é (contato de quais fábricas) é lido a cada chamada, então
 * desvincular na tela da Factory vale na hora.
 */

export const SESSION_SECONDS = 7 * 24 * 3600;

type Payload = { o: string; e: number };

const b64url = (buf: Buffer) => buf.toString("base64url");
const sign = (secret: string, data: string) => b64url(createHmac("sha256", secret).update(data).digest());

export function createSession(secret: string, openId: string, now = Date.now()): string {
  const payload: Payload = { o: openId, e: Math.floor(now / 1000) + SESSION_SECONDS };
  const data = b64url(Buffer.from(JSON.stringify(payload)));
  return `${data}.${sign(secret, data)}`;
}

/** OpenID da sessão, ou null se adulterada/vencida. */
export function readSession(secret: string, token: string, now = Date.now()): string | null {
  const [data, mac] = token.split(".");
  if (!data || !mac) return null;
  const expected = Buffer.from(sign(secret, data));
  const received = Buffer.from(mac);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as Partial<Payload>;
    if (typeof payload.o !== "string" || typeof payload.e !== "number") return null;
    if (payload.e * 1000 < now) return null;
    return payload.o;
  } catch {
    return null;
  }
}

/** Sem 0/O/1/I/L: o fornecedor pode precisar digitar o código. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const INVITE_CODE_LENGTH = 8;
/** O convite vale 7 dias: a equipe manda o código pelo WeChat/e-mail e o fornecedor usa quando puder. */
export const INVITE_DAYS = 7;

export function newInviteCode(): string {
  let code = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** O que a pessoa digitou → código canônico (maiúsculas, sem espaço/hífen), ou null. */
export function normalizeInviteCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== INVITE_CODE_LENGTH) return null;
  return [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}
