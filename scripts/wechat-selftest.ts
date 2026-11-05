/**
 * Autoteste do WeChat (Service Account) sem conta: criptografia do callback
 * (ida e volta, assinaturas, AppID), o parser da resposta ("PL 1473 texto"),
 * o código do QR de vínculo e os campos do template.
 *
 *   npx tsx scripts/wechat-selftest.ts
 *
 * Sai com código 1 se algo falhar. Não toca em banco nem em rede.
 */
import { createHash, randomBytes } from "node:crypto";

import { bindScene, profileIdFromEventKey } from "../lib/wechat/bind";
import {
  decryptWechat,
  encryptWechat,
  msgSignature,
  plainSignature,
  signatureMatches,
  xmlField,
} from "../lib/wechat/crypto";
import { parseReply } from "../lib/wechat/parse-reply";
import { parseTemplateFields, templateData } from "../lib/wechat/template";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` → ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

// EncodingAESKey é 43 chars base64 (32 bytes sem o "=").
const aesKey = randomBytes(32).toString("base64").replace(/=+$/, "");
const appId = "wx1234567890abcdef";
const token = "TestToken123";

// 1. Ida e volta com texto chinês + emoji (bytes ≠ caracteres).
const xml =
  "<xml><ToUserName><![CDATA[gh_abcdef123456]]></ToUserName>" +
  "<FromUserName><![CDATA[oAbCdEfGhIjKlMnOpQrStUvWxYz0]]></FromUserName><CreateTime>1730700000</CreateTime>" +
  "<MsgType><![CDATA[text]]></MsgType><Content><![CDATA[PL 1473 货已装柜 ✅]]></Content>" +
  "<MsgId>7000000000000000001</MsgId></xml>";
const encrypted = encryptWechat(aesKey, xml, appId);
const back = decryptWechat(aesKey, encrypted);
check("decrypt(encrypt(x)) = x", back.message === xml, back.message);
check("appId volta junto", back.appId === appId, back.appId);

// 2. Todos os tamanhos de padding (1..32) — o bug clássico é o bloco cheio.
for (let n = 0; n < 40; n++) {
  const msg = "x".repeat(n);
  const r = decryptWechat(aesKey, encryptWechat(aesKey, msg, appId));
  if (r.message !== msg || r.appId !== appId) check(`padding n=${n}`, false, r);
}
check("padding 0..39 chars", true);

// 3. Chave errada não decifra o texto certo.
const otherKey = randomBytes(32).toString("base64").replace(/=+$/, "");
let wrongKeyOk = false;
try {
  wrongKeyOk = decryptWechat(otherKey, encrypted).message === xml;
} catch {
  wrongKeyOk = false;
}
check("chave errada falha", !wrongKeyOk);

// 4. Assinaturas.
const sig = msgSignature(token, "1730700000", "nonce42", encrypted);
check("msg_signature confere", signatureMatches(sig, msgSignature(token, "1730700000", "nonce42", encrypted)));
check("msg_signature com nonce trocado falha", !signatureMatches(sig, msgSignature(token, "1730700000", "nonce43", encrypted)));
check("assinatura de tamanho diferente falha", !signatureMatches(sig, sig.slice(1)));
check(
  "signature = sha1(sort(token, timestamp, nonce))",
  plainSignature(token, "1409304348", "xxxxxx") ===
    createHash("sha1").update(["1409304348", "TestToken123", "xxxxxx"].sort().join("")).digest("hex")
);
check("signature não depende da ordem dos argumentos", plainSignature("a", "b", "c") === plainSignature("c", "a", "b"));

// 5. XML.
check("xmlField CDATA", xmlField(xml, "Content") === "PL 1473 货已装柜 ✅");
check("xmlField número", xmlField(xml, "MsgId") === "7000000000000000001");
check("xmlField ausente", xmlField(xml, "Nope") === null);

// 6. Parser da resposta.
const cases: [string, ReturnType<typeof parseReply>][] = [
  ["1676 ok, confirmed", { type: "order", number: "1676", body: "ok, confirmed" }],
  ["PL 1473 loaded", { type: "pre_loading", number: "1473", body: "loaded" }],
  ["pl1473 loaded", { type: "pre_loading", number: "1473", body: "loaded" }],
  ["SH 1473 arrived\nall good", { type: "shipment", number: "1473", body: "arrived\nall good" }],
  ["#1676: 已确认", { type: "order", number: "1676", body: "已确认" }],
  ["1676 - done", { type: "order", number: "1676", body: "done" }],
  ["ok, confirmed", null],
  ["1676", null],
  ["1676ok", null],
  ["  ", null],
];
for (const [input, expected] of cases) {
  const got = parseReply(input);
  check(`parseReply(${JSON.stringify(input)})`, JSON.stringify(got) === JSON.stringify(expected), got);
}

// 7. QR de vínculo: subscribe traz "qrscene_<scene>", SCAN traz "<scene>".
const pid = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
check("scene cabe no limite de 64", bindScene(pid).length <= 64);
check("EventKey de subscribe", profileIdFromEventKey(`qrscene_${bindScene(pid)}`) === pid);
check("EventKey de SCAN", profileIdFromEventKey(bindScene(pid)) === pid);
check("EventKey de outro QR", profileIdFromEventKey("qrscene_promo2026") === null);
check("EventKey com id inválido", profileIdFromEventKey("bind:../../x") === null);
check("EventKey vazio", profileIdFromEventKey(null) === null);

// 8. Campos do template.
const fields = parseTemplateFields("thing1=author,character_string2=record,thing3=body,time4=time");
check("parseTemplateFields ok", fields?.length === 4, fields);
check("parseTemplateFields com valor desconhecido", parseTemplateFields("thing1=nope") === null);
check("parseTemplateFields vazio", parseTemplateFields("") === null);
const data = templateData(fields ?? [], {
  author: "Zhang San",
  record: "Order 1676",
  client: "ACME",
  body: "货已装柜,请确认出货日期和数量,谢谢大家的配合!",
  reply: "1676 …",
  time: "2026-11-04 16:20",
});
check("thing corta em 20 com …", [...data.thing3].length === 20 && data.thing3.endsWith("…"), data.thing3);
check("thing curto fica igual", data.thing1 === "Zhang San", data.thing1);
check("campo sem tipo conhecido não corta", templateData([["body", "body"]], {
  author: "", record: "", client: "", body: "x".repeat(300), reply: "", time: "",
}).body.length === 300);

if (failures) {
  console.error(`\n${failures} falha(s).`);
  process.exit(1);
}
console.log("\nTudo certo.");
