// Relay do WeChat (Service Account, 服务号) — roda num servidor de IP FIXO,
// cadastrado na "IP白名单" da conta (开发 → 基本配置). A Vercel não tem IP de
// saída fixo, então o SOT manda as chamadas de API para cá e o relay repassa.
//
// Sem dependências (Node 18+). Duas rotas:
//   POST /proxy     SOT → WeChat. Bearer RELAY_SECRET. Corpo:
//                   { method, path: "/cgi-bin/...", query, body }.
//   GET|POST /callback   WeChat → SOT. Repassa query + corpo, sem mexer, para
//                   SOT_CALLBACK_URL. Só necessário se o WeChat não alcançar
//                   o domínio do SOT (ver README).
//
// Envs: RELAY_SECRET (obrigatória), SOT_CALLBACK_URL (opcional), PORT (8080).

import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const WECHAT_API = "https://api.weixin.qq.com";
const MAX_BODY = 1024 * 1024;
const TIMEOUT_MS = 10_000;

const SECRET = process.env.RELAY_SECRET;
const SOT_CALLBACK_URL = process.env.SOT_CALLBACK_URL;
const PORT = Number(process.env.PORT || 8080);

if (!SECRET || SECRET.length < 32) {
  console.error("RELAY_SECRET ausente ou curta (mínimo 32 caracteres).");
  process.exit(1);
}

const digest = (s) => createHash("sha256").update(s).digest();
const secretOk = (header) => {
  const token = (header || "").replace(/^Bearer\s+/i, "");
  return timingSafeEqual(digest(token), digest(SECRET));
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

async function proxy(req, res) {
  if (req.method !== "POST") return send(res, 405, '{"error":"POST only"}');
  if (!secretOk(req.headers.authorization)) return send(res, 401, '{"error":"unauthorized"}');

  let payload;
  try {
    payload = JSON.parse((await readBody(req)).toString("utf8"));
  } catch {
    return send(res, 400, '{"error":"bad json"}');
  }
  const { method, path, query, body } = payload ?? {};
  // Só a API do WeChat — o relay não é um proxy aberto.
  if (!["GET", "POST"].includes(method) || typeof path !== "string" || !/^\/cgi-bin\/[a-z0-9_/]+$/i.test(path)) {
    return send(res, 400, '{"error":"invalid method/path"}');
  }

  const url = `${WECHAT_API}${path}?${new URLSearchParams(query ?? {})}`;
  try {
    const upstream = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    send(res, upstream.status, await upstream.text());
  } catch (error) {
    console.error(`[proxy] ${method} ${path}:`, error.message);
    send(res, 502, JSON.stringify({ error: "upstream failed" }));
  }
}

async function callback(req, res, search) {
  if (!SOT_CALLBACK_URL) return send(res, 404, "callback relay disabled", "text/plain");
  if (!["GET", "POST"].includes(req.method)) return send(res, 405, "GET/POST only", "text/plain");
  try {
    const body = req.method === "POST" ? await readBody(req) : undefined;
    const upstream = await fetch(`${SOT_CALLBACK_URL}${search}`, {
      method: req.method,
      headers: body ? { "Content-Type": req.headers["content-type"] || "text/xml" } : undefined,
      body,
      signal: AbortSignal.timeout(4_500), // WeChat desiste em 5s
    });
    send(res, upstream.status, await upstream.text(), "text/plain; charset=utf-8");
  } catch (error) {
    console.error("[callback]", error.message);
    send(res, 502, "", "text/plain");
  }
}

createServer((req, res) => {
  const { pathname, search } = new URL(req.url, "http://relay");
  if (pathname === "/proxy") return void proxy(req, res);
  if (pathname === "/callback") return void callback(req, res, search);
  if (pathname === "/health") return send(res, 200, '{"ok":true}');
  send(res, 404, '{"error":"not found"}');
}).listen(PORT, () => console.log(`wechat relay on :${PORT}`));
