import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Assinatura e criptografia do callback da Service Account (服务号) do WeChat.
 *
 * Contrato oficial, implementado à mão com `node:crypto` (sem SDK):
 *  - `signature`     = sha1(sort([token, timestamp, nonce]).join(""))
 *                      (verificação da URL e todo POST, em qualquer modo)
 *  - `msg_signature` = sha1(sort([token, timestamp, nonce, encrypt]).join(""))
 *                      (só no modo seguro, 安全模式)
 *  - chave AES = base64(EncodingAESKey + "=") → 32 bytes; IV = 16 primeiros
 *  - AES-256-CBC, padding PKCS#7 em blocos de 32 bytes
 *  - texto claro = random(16) | len(msg) em 4 bytes big-endian | msg | AppID
 *
 * Funções puras — scripts/wechat-selftest.ts cobre a ida e volta sem conta.
 */

const BLOCK = 32;

const sha1 = (parts: string[]) => createHash("sha1").update(parts.sort().join("")).digest("hex");

/** `signature` da query: verificação da URL (GET) e todo callback (POST). */
export function plainSignature(token: string, timestamp: string, nonce: string): string {
  return sha1([token, timestamp, nonce]);
}

/** `msg_signature` da query no modo seguro: cobre também o `<Encrypt>`. */
export function msgSignature(token: string, timestamp: string, nonce: string, encrypt: string): string {
  return sha1([token, timestamp, nonce, encrypt]);
}

export function signatureMatches(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

function aesKey(encodingAesKey: string): Buffer {
  const key = Buffer.from(`${encodingAesKey}=`, "base64");
  if (key.length !== 32) throw new Error("WECHAT_AES_KEY must be the 43-char EncodingAESKey.");
  return key;
}

export function decryptWechat(
  encodingAesKey: string,
  encrypted: string
): { message: string; appId: string } {
  const key = aesKey(encodingAesKey);
  const decipher = createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const padded = Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]);

  const pad = padded[padded.length - 1];
  if (pad < 1 || pad > BLOCK) throw new Error("Invalid padding.");
  const plain = padded.subarray(0, padded.length - pad);

  const content = plain.subarray(16);
  const length = content.readUInt32BE(0);
  if (length > content.length - 4) throw new Error("Invalid message length.");
  return {
    message: content.subarray(4, 4 + length).toString("utf8"),
    appId: content.subarray(4 + length).toString("utf8"),
  };
}

export function encryptWechat(encodingAesKey: string, message: string, appId: string): string {
  const key = aesKey(encodingAesKey);
  const msg = Buffer.from(message, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(msg.length, 0);
  const plain = Buffer.concat([randomBytes(16), len, msg, Buffer.from(appId, "utf8")]);
  const pad = BLOCK - (plain.length % BLOCK);
  const padded = Buffer.concat([plain, Buffer.alloc(pad, pad)]);

  const cipher = createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
}

/**
 * Lê um campo do XML do WeChat (`<Tag><![CDATA[x]]></Tag>` ou `<Tag>123</Tag>`).
 * O XML deles é plano e de esquema fixo — um parser completo seria peso morto.
 */
export function xmlField(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${tag}>`));
  if (!m) return null;
  return m[1] ?? m[2] ?? null;
}
