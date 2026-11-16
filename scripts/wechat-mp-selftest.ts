/**
 * Autoteste do Mini Program do fornecedor (fase 2, docs §6.17) sem conta: a
 * sessão assinada (ida e volta, adulteração, vencimento) e o código de convite.
 *
 *   npx tsx scripts/wechat-mp-selftest.ts
 *
 * Sai com código 1 se algo falhar. Não toca em banco nem em rede.
 */
import {
  INVITE_CODE_LENGTH,
  SESSION_SECONDS,
  createSession,
  newInviteCode,
  normalizeInviteCode,
  readSession,
} from "../lib/wechat-mp/session";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` → ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

const secret = "test-secret";
const openId = "oABC_123-xyz";
const now = Date.parse("2026-11-16T12:00:00Z");

const token = createSession(secret, openId, now);
check("sessão: ida e volta", readSession(secret, token, now) === openId, readSession(secret, token, now));
check("sessão: outro segredo recusa", readSession("other", token, now) === null);
const [data, mac] = token.split(".");
const forged = Buffer.from(JSON.stringify({ o: "intruder", e: 9999999999 })).toString("base64url");
check("sessão: payload trocado recusa", readSession(secret, `${forged}.${mac}`, now) === null);
check("sessão: sem assinatura recusa", readSession(secret, data, now) === null);
check("sessão: lixo recusa", readSession(secret, "a.b.c", now) === null);
check(
  "sessão: vencida recusa",
  readSession(secret, token, now + (SESSION_SECONDS + 1) * 1000) === null
);
check("sessão: ainda válida no fim", readSession(secret, token, now + (SESSION_SECONDS - 1) * 1000) === openId);

const codes = new Set(Array.from({ length: 500 }, () => newInviteCode()));
check("convite: tamanho", [...codes].every((c) => c.length === INVITE_CODE_LENGTH));
check("convite: sem caracteres ambíguos", [...codes].every((c) => !/[01OIL]/.test(c)));
check("convite: variados", codes.size > 490, codes.size);
const sample = [...codes][0];
check("convite: o gerado é aceito", normalizeInviteCode(sample) === sample);
check(
  "convite: minúsculas/espaço/hífen",
  normalizeInviteCode(` ${sample.slice(0, 4).toLowerCase()}-${sample.slice(4)} `) === sample
);
check("convite: tamanho errado recusa", normalizeInviteCode("ABC") === null);
check("convite: caractere ambíguo recusa", normalizeInviteCode("ABCD0123") === null);

if (failures) {
  console.error(`\n${failures} falha(s).`);
  process.exit(1);
}
console.log("\nTudo certo.");
