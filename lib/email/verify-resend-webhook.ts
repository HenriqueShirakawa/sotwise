import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verificação manual da assinatura do webhook do Resend (Svix por baixo dos
 * panos) — sem adicionar a dependência `svix`, mesmo espírito de
 * `lib/email/resend.ts` já evitar o SDK do Resend.
 *
 * Algoritmo (confirmado na doc do Svix, 09/09/2026):
 *   conteúdo assinado = `${svix-id}.${svix-timestamp}.${rawBody}`
 *   chave = base64-decode do segredo SEM o prefixo `whsec_`
 *   assinatura = HMAC-SHA256(chave, conteúdo), base64
 *   `svix-signature` traz uma ou mais assinaturas espaço-separadas no
 *   formato `v1,<base64>` (rotação de chave) — basta bater com uma.
 *
 * Timestamp fora da tolerância é rejeitado (replay). `rawBody` tem que ser o
 * corpo CRU da request (antes de qualquer JSON.parse/reserialização) — a
 * assinatura é sensível a byte a mais.
 */

const TOLERANCE_SECONDS = 5 * 60;

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export function verifyResendWebhook(params: {
  rawBody: string;
  svixId: string | null;
  svixTimestamp: string | null;
  svixSignature: string | null;
  secret: string;
}): VerifyResult {
  const { rawBody, svixId, svixTimestamp, svixSignature, secret } = params;

  if (!svixId || !svixTimestamp || !svixSignature) {
    return { ok: false, reason: "Missing svix-id/svix-timestamp/svix-signature headers." };
  }

  const timestamp = Number(svixTimestamp);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: "Invalid svix-timestamp." };
  }
  const ageSeconds = Math.abs(Date.now() / 1000 - timestamp);
  if (ageSeconds > TOLERANCE_SECONDS) {
    return { ok: false, reason: "svix-timestamp outside tolerance window." };
  }

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = createHmac("sha256", secretBytes).update(signedContent).digest();

  const candidates = svixSignature.split(" ").map((v) => v.split(",")[1]).filter(Boolean);
  for (const candidate of candidates) {
    let provided: Buffer;
    try {
      provided = Buffer.from(candidate, "base64");
    } catch {
      continue;
    }
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "Signature mismatch." };
}
