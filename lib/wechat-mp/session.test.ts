import { describe, expect, it } from "vitest";

import {
  INVITE_CODE_LENGTH,
  SESSION_SECONDS,
  createSession,
  newInviteCode,
  normalizeInviteCode,
  readSession,
} from "./session";

// Ex-scripts/wechat-mp-selftest.ts: sessão assinada do Mini Program e convite.

const secret = "test-secret";
const openId = "oABC_123-xyz";
const now = Date.parse("2026-11-16T12:00:00Z");
const token = createSession(secret, openId, now);

describe("sessão do Mini Program", () => {
  it("lê de volta o OpenID que assinou", () => {
    expect(readSession(secret, token, now)).toBe(openId);
  });

  it("recusa outro segredo, payload trocado, token sem assinatura e lixo", () => {
    const [data, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ o: "intruder", e: 9999999999 })).toString("base64url");
    expect(readSession("other", token, now)).toBeNull();
    expect(readSession(secret, `${forged}.${mac}`, now)).toBeNull();
    expect(readSession(secret, data, now)).toBeNull();
    expect(readSession(secret, "a.b.c", now)).toBeNull();
  });

  it("vale até o fim do prazo e vence depois", () => {
    expect(readSession(secret, token, now + (SESSION_SECONDS - 1) * 1000)).toBe(openId);
    expect(readSession(secret, token, now + (SESSION_SECONDS + 1) * 1000)).toBeNull();
  });
});

describe("código de convite", () => {
  const codes = Array.from({ length: 500 }, () => newInviteCode());

  it("tem o tamanho certo, sem caracteres ambíguos (0 1 O I L) e varia", () => {
    expect(codes.every((c) => c.length === INVITE_CODE_LENGTH)).toBe(true);
    expect(codes.every((c) => !/[01OIL]/.test(c))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(490);
  });

  it("normaliza minúsculas, espaços e hífen", () => {
    const sample = codes[0];
    expect(normalizeInviteCode(sample)).toBe(sample);
    expect(normalizeInviteCode(` ${sample.slice(0, 4).toLowerCase()}-${sample.slice(4)} `)).toBe(sample);
  });

  it("recusa tamanho errado e caractere ambíguo", () => {
    expect(normalizeInviteCode("ABC")).toBeNull();
    expect(normalizeInviteCode("ABCD0123")).toBeNull();
  });
});
