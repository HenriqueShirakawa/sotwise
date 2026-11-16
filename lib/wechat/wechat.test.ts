import { createHash, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { bindScene, profileIdFromEventKey } from "./bind";
import {
  decryptWechat,
  encryptWechat,
  msgSignature,
  plainSignature,
  signatureMatches,
  xmlField,
} from "./crypto";
import { parseReply } from "./parse-reply";
import { parseTemplateFields, templateData } from "./template";

// Ex-scripts/wechat-selftest.ts. Sem conta, sem banco, sem rede.

/** EncodingAESKey é 43 chars base64 (32 bytes sem o "="). */
const newAesKey = () => randomBytes(32).toString("base64").replace(/=+$/, "");
const aesKey = newAesKey();
const appId = "wx1234567890abcdef";
const token = "TestToken123";

const xml =
  "<xml><ToUserName><![CDATA[gh_abcdef123456]]></ToUserName>" +
  "<FromUserName><![CDATA[oAbCdEfGhIjKlMnOpQrStUvWxYz0]]></FromUserName><CreateTime>1730700000</CreateTime>" +
  "<MsgType><![CDATA[text]]></MsgType><Content><![CDATA[PL 1473 货已装柜 ✅]]></Content>" +
  "<MsgId>7000000000000000001</MsgId></xml>";
const encrypted = encryptWechat(aesKey, xml, appId);

describe("criptografia do callback", () => {
  it("decifra o que cifrou (texto chinês + emoji: bytes ≠ caracteres) e devolve o AppID", () => {
    expect(decryptWechat(aesKey, encrypted)).toEqual({ message: xml, appId });
  });

  it("funciona em todos os tamanhos de padding (o bug clássico é o bloco cheio)", () => {
    for (let n = 0; n < 40; n++) {
      const msg = "x".repeat(n);
      expect(decryptWechat(aesKey, encryptWechat(aesKey, msg, appId))).toEqual({ message: msg, appId });
    }
  });

  it("não decifra com a chave errada", () => {
    let message: string | null = null;
    try {
      message = decryptWechat(newAesKey(), encrypted).message;
    } catch {
      message = null;
    }
    expect(message).not.toBe(xml);
  });
});

describe("assinaturas", () => {
  const sig = msgSignature(token, "1730700000", "nonce42", encrypted);

  it("msg_signature confere com ela mesma e falha com nonce trocado", () => {
    expect(signatureMatches(sig, msgSignature(token, "1730700000", "nonce42", encrypted))).toBe(true);
    expect(signatureMatches(sig, msgSignature(token, "1730700000", "nonce43", encrypted))).toBe(false);
  });

  it("assinatura de tamanho diferente falha (sem lançar)", () => {
    expect(signatureMatches(sig, sig.slice(1))).toBe(false);
  });

  it("signature = sha1 dos três valores ordenados", () => {
    const expected = createHash("sha1")
      .update(["1409304348", "TestToken123", "xxxxxx"].sort().join(""))
      .digest("hex");
    expect(plainSignature(token, "1409304348", "xxxxxx")).toBe(expected);
    expect(plainSignature("a", "b", "c")).toBe(plainSignature("c", "a", "b"));
  });
});

describe("xmlField", () => {
  it("lê CDATA, número e devolve null para tag ausente", () => {
    expect(xmlField(xml, "Content")).toBe("PL 1473 货已装柜 ✅");
    expect(xmlField(xml, "MsgId")).toBe("7000000000000000001");
    expect(xmlField(xml, "Nope")).toBeNull();
  });
});

describe("parseReply (resposta da equipe: \"PL 1473 texto\")", () => {
  it.each([
    ["1676 ok, confirmed", { type: "order", number: "1676", body: "ok, confirmed" }],
    ["PL 1473 loaded", { type: "pre_loading", number: "1473", body: "loaded" }],
    ["pl1473 loaded", { type: "pre_loading", number: "1473", body: "loaded" }],
    ["SH 1473 arrived\nall good", { type: "shipment", number: "1473", body: "arrived\nall good" }],
    ["#1676: 已确认", { type: "order", number: "1676", body: "已确认" }],
    ["1676 - done", { type: "order", number: "1676", body: "done" }],
  ])("%j → registro + texto", (input, expected) => {
    expect(parseReply(input)).toEqual(expected);
  });

  it.each(["ok, confirmed", "1676", "1676ok", "  "])("%j → null (sem número ou sem texto)", (input) => {
    expect(parseReply(input)).toBeNull();
  });
});

describe("QR de vínculo", () => {
  const pid = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

  it("scene cabe no limite de 64 do WeChat", () => {
    expect(bindScene(pid).length).toBeLessThanOrEqual(64);
  });

  it("lê o profile do EventKey de subscribe (qrscene_) e de SCAN", () => {
    expect(profileIdFromEventKey(`qrscene_${bindScene(pid)}`)).toBe(pid);
    expect(profileIdFromEventKey(bindScene(pid))).toBe(pid);
  });

  it("ignora outro QR, id inválido e vazio", () => {
    expect(profileIdFromEventKey("qrscene_promo2026")).toBeNull();
    expect(profileIdFromEventKey("bind:../../x")).toBeNull();
    expect(profileIdFromEventKey(null)).toBeNull();
  });
});

describe("campos do template", () => {
  const vars = {
    author: "Zhang San",
    record: "Order 1676",
    client: "ACME",
    body: "货已装柜,请确认出货日期和数量,谢谢大家的配合!",
    reply: "1676 …",
    time: "2026-11-04 16:20",
  };

  it("parseTemplateFields aceita a config válida e recusa valor desconhecido ou vazio", () => {
    expect(parseTemplateFields("thing1=author,character_string2=record,thing3=body,time4=time")).toHaveLength(4);
    expect(parseTemplateFields("thing1=nope")).toBeNull();
    expect(parseTemplateFields("")).toBeNull();
  });

  it("campo thing corta em 20 caracteres com … e mantém o que é curto", () => {
    const fields = parseTemplateFields("thing1=author,thing3=body")!;
    const data = templateData(fields, vars);
    expect([...data.thing3]).toHaveLength(20);
    expect(data.thing3.endsWith("…")).toBe(true);
    expect(data.thing1).toBe("Zhang San");
  });

  it("campo sem tipo conhecido não corta", () => {
    const data = templateData([["body", "body"]], { ...vars, body: "x".repeat(300) });
    expect(data.body).toHaveLength(300);
  });
});
