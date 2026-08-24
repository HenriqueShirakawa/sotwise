/**
 * Conferência ao vivo dos endpoints do GSS — SÓ LEITURA.
 *
 * Para cada endpoint: um GET (status, nº de linhas, chaves do 1º item) e um
 * OPTIONS (o header `Allow` do Django REST, que revela quais verbos o endpoint
 * aceita — útil para saber o que o CRUD do lado deles pode mexer).
 *
 * Nenhuma requisição de escrita é feita. `OPTIONS` não altera nada.
 *
 *   npx tsx scripts/sync-gss/check-endpoints.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { GSS_ENDPOINTS, gssGet } from "../../lib/gss/client";

/** Endpoints do mapa + os que a doc cita como ausentes/extras, para reconferir. */
const EXTRAS = [
  "/core/shipment-model/",
  "/core/currency/",
  "/core/incoterm/",
] as const;

const BASE = (process.env.GSS_API_BASE || "https://api.gssdatahub.com/v1").replace(/\/+$/, "");
const CF = {
  "CF-Access-Client-Id": process.env.GSS_CF_ACCESS_CLIENT_ID!,
  "CF-Access-Client-Secret": process.env.GSS_CF_ACCESS_CLIENT_SECRET!,
};

/** Token próprio, só para o OPTIONS (o client exporta apenas GET). */
async function token(): Promise<string> {
  const res = await fetch(`${BASE}/authentication/token/`, {
    method: "POST",
    headers: { ...CF, "Content-Type": "application/json" },
    body: JSON.stringify({ username: process.env.GSS_USERNAME, password: process.env.GSS_PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${res.status}`);
  return ((await res.json()) as { access: string }).access;
}

async function allow(path: string, jwt: string): Promise<string> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "OPTIONS",
      headers: { ...CF, Authorization: `Bearer ${jwt}` },
    });
    return res.headers.get("allow") ?? `(sem Allow, ${res.status})`;
  } catch (e) {
    return `(falhou: ${String(e).slice(0, 40)})`;
  }
}

async function main() {
  const jwt = await token();
  console.log(`\n== GSS ${BASE} — conferência de endpoints (só leitura) ==\n`);
  console.log("recurso              endpoint                      GET      linhas  verbos aceitos");

  const alvos: [string, string][] = [
    ...Object.entries(GSS_ENDPOINTS),
    ...EXTRAS.map((e) => ["(extra)", e] as [string, string]),
  ];

  const amostras: string[] = [];

  for (const [key, path] of alvos) {
    const r = await gssGet<unknown>(path);
    let status = "OK";
    let linhas = "";
    if (!r.ok) {
      status = r.error.match(/GSS (\d{3})/)?.[1] ?? "ERRO";
      linhas = "-";
    } else if (Array.isArray(r.data)) {
      linhas = String(r.data.length);
      if (r.data.length) amostras.push(`${path}\n   ${Object.keys(r.data[0] as object).join(", ")}`);
    } else {
      linhas = "(objeto)";
    }
    const verbos = r.ok ? await allow(path, jwt) : "-";
    console.log(`${key.padEnd(20)} ${path.padEnd(29)} ${status.padEnd(8)} ${linhas.padStart(6)}  ${verbos}`);
  }

  console.log("\n== campos de cada payload (1ª linha) ==");
  for (const a of amostras) console.log(a);
}

main().catch((e) => {
  console.error("FALHOU:", e);
  process.exit(1);
});
