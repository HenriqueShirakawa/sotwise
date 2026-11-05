import { after } from "next/server";

import { wechatConfig } from "@/lib/wechat/client";
import { decryptWechat, msgSignature, plainSignature, signatureMatches, xmlField } from "@/lib/wechat/crypto";
import { handleWechatInbound } from "@/lib/wechat/inbound";

/**
 * Callback da Service Account (服务号 → 开发 → 基本配置 → 服务器配置). URL:
 *   https://<domínio>/api/wechat/callback
 *
 * GET  = verificação da URL: confere `signature` e devolve `echostr`.
 * POST = mensagem/evento: confere a assinatura, decifra (modo seguro) e
 *        responde NA HORA — o WeChat espera ≤ 5s e reenvia até 3x. O trabalho
 *        roda no `after`.
 *
 * Modos: com `WECHAT_AES_KEY` definida, SÓ aceita o modo seguro (安全模式), em
 * que o `msg_signature` cobre o corpo. Sem ela, aceita texto claro (明文模式) —
 * é o único que o 测试号 oferece; ali a assinatura não cobre o corpo, por isso
 * a janela de 5 min no timestamp.
 *
 * Sem sessão de propósito: quem autentica é a assinatura (token + AES key).
 */
export const dynamic = "force-dynamic";

const MAX_SKEW_SECONDS = 300;

function secrets() {
  const cfg = wechatConfig();
  const token = process.env.WECHAT_TOKEN;
  if (!cfg || !token) return null;
  return { cfg, token, aesKey: process.env.WECHAT_AES_KEY || null };
}

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

function signedQuery(request: Request, token: string) {
  const q = new URL(request.url).searchParams;
  const timestamp = q.get("timestamp") ?? "";
  const nonce = q.get("nonce") ?? "";
  const ok = signatureMatches(plainSignature(token, timestamp, nonce), q.get("signature") ?? "");
  return { q, timestamp, nonce, ok };
}

export async function GET(request: Request) {
  const s = secrets();
  if (!s) return text("WeChat not configured.", 503);

  const { q, ok } = signedQuery(request, s.token);
  if (!ok) return text("Invalid signature.", 401);
  return text(q.get("echostr") ?? "");
}

export async function POST(request: Request) {
  const s = secrets();
  if (!s) return text("WeChat not configured.", 503);

  const { q, timestamp, nonce, ok } = signedQuery(request, s.token);
  if (!ok) return text("Invalid signature.", 401);
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) {
    return text("Stale timestamp.", 401);
  }

  const raw = await request.text();
  let xml: string;
  if (q.get("encrypt_type") === "aes") {
    if (!s.aesKey) return text("WECHAT_AES_KEY not set.", 503);
    const encrypt = xmlField(raw, "Encrypt");
    if (!encrypt) return text("Missing Encrypt.", 400);
    if (!signatureMatches(msgSignature(s.token, timestamp, nonce, encrypt), q.get("msg_signature") ?? "")) {
      return text("Invalid signature.", 401);
    }
    try {
      const { message, appId } = decryptWechat(s.aesKey, encrypt);
      if (appId !== s.cfg.appId) return text("Wrong AppID.", 401);
      xml = message;
    } catch {
      return text("Invalid payload.", 400);
    }
  } else {
    // Com chave AES configurada, texto claro é recusado: o corpo não estaria assinado.
    if (s.aesKey) return text("Encrypted mode required.", 400);
    xml = raw;
  }

  const origin = new URL(request.url).origin;
  after(() =>
    handleWechatInbound(xml, origin).catch((error) => console.error("[wechat] inbound falhou:", error))
  );
  // "success" = recebido, sem resposta passiva (a resposta vai pela API).
  return text("success");
}
