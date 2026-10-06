/**
 * Gera a collection do Postman "SOTWISE x GSS — Swagger completo" a partir dos
 * DOIS contratos:
 *   1. GSS     — /v1/openapi.json do GSS (Swagger 2.0), baixado AO VIVO
 *   2. SOTWISE — domain/api/openapi.ts (OpenAPI 3.1, o mesmo de /api/docs)
 *
 * Uma requisição por operação (e uma por exemplo nomeado do nosso spec, ex.:
 * POST /api/batches "webhook"/"empty"/…). Nada é chamado além do GET do spec.
 *
 *   npx tsx scripts/postman/build-swagger-collection.ts
 *
 * Saída: docs/postman/SOTWISE-x-GSS-Swagger.postman_collection.json
 * Variáveis de environment usadas: ver docs/postman/README.md.
 *
 * Corpos de exemplo: o exemplo do spec quando existe; senão só os campos
 * OBRIGATÓRIOS (PATCH sai `{}`) — de propósito, para um Send sem querer não
 * zerar campos. A lista completa de campos vai na descrição de cada request.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { openApiSpec } from "../../domain/api/openapi";
import { gssGet } from "../../lib/gss/client";

type Json = Record<string, any>;
type PmItem = Json;

const OUT = resolve("docs/postman/SOTWISE-x-GSS-Swagger.postman_collection.json");
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

// ---------------------------------------------------------------------------
// Exemplo a partir de schema (Swagger 2.0 `definitions` e OAS 3.1 `components`)
// ---------------------------------------------------------------------------

function makeResolver(root: Json) {
  return (schema: Json | undefined): Json => {
    let s = schema ?? {};
    for (let i = 0; i < 10 && s.$ref; i++) {
      const parts = String(s.$ref).replace(/^#\//, "").split("/");
      s = parts.reduce((acc: Json, k) => acc?.[k], root) ?? {};
    }
    if (s.allOf) {
      const merged: Json = { type: "object", properties: {}, required: [] };
      for (const part of s.allOf) {
        const r = makeResolver(root)(part);
        Object.assign(merged.properties, r.properties ?? {});
        merged.required.push(...(r.required ?? []));
      }
      return { ...s, ...merged, allOf: undefined };
    }
    return s;
  };
}

function primaryType(s: Json): string | undefined {
  if (Array.isArray(s.type)) return s.type.find((t: string) => t !== "null");
  return s.type;
}

function sampleValue(schemaIn: Json, res: (s?: Json) => Json, depth = 0, onlyRequired = true): unknown {
  const s = res(schemaIn);
  if (s.example !== undefined) return s.example;
  if (Array.isArray(s.examples) && s.examples.length) return s.examples[0];
  if (s.default !== undefined && s.default !== null) return s.default;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum.find((v: unknown) => v !== null) ?? s.enum[0];
  if (s.const !== undefined) return s.const;
  const alt = s.oneOf ?? s.anyOf;
  if (alt) return sampleValue(alt.find((x: Json) => res(x).type !== "null") ?? alt[0], res, depth, onlyRequired);

  const hint = /Example:\s*([^\s,;]+?)\.?(?:\s|$)/.exec(String(s.description ?? ""))?.[1];
  const t = primaryType(s) ?? (s.properties ? "object" : undefined);
  switch (t) {
    case "object":
      return depth > 4 ? {} : sampleObject(s, res, depth + 1, onlyRequired);
    case "array":
      return depth > 4 ? [] : [sampleValue(s.items ?? {}, res, depth + 1, onlyRequired)];
    case "integer":
    case "number":
      if (hint && !Number.isNaN(Number(hint))) return Number(hint);
      return typeof s.minimum === "number" ? s.minimum : 1;
    case "boolean":
      return false;
    case "string":
      if (hint) return hint.replace(/^['"]|['"]$/g, "");
      if (s.format === "date") return "2026-10-06";
      if (s.format === "date-time") return "2026-10-06T12:00:00Z";
      if (s.format === "email") return "user@example.com";
      if (s.format === "uuid") return "00000000-0000-0000-0000-000000000000";
      if (s.format === "uri") return "https://example.com";
      return "string";
    default:
      return null;
  }
}

function sampleObject(s: Json, res: (s?: Json) => Json, depth: number, onlyRequired: boolean): Json {
  const out: Json = {};
  const required: string[] = s.required ?? [];
  for (const [name, prop] of Object.entries<Json>(s.properties ?? {})) {
    const p = res(prop);
    if (p.readOnly) continue;
    if (onlyRequired && !required.includes(name)) continue;
    out[name] = sampleValue(p, res, depth, onlyRequired);
  }
  return out;
}

/** Lista "campo (tipo, obrigatório) — descrição" para a descrição do request. */
function fieldDocs(schemaIn: Json | undefined, res: (s?: Json) => Json): string {
  if (!schemaIn) return "";
  let s = res(schemaIn);
  if (primaryType(s) === "array" && s.items) s = res(s.items);
  const props = Object.entries<Json>(s.properties ?? {});
  if (!props.length) return "";
  const required: string[] = s.required ?? [];
  const lines = props
    .filter(([, p]) => !res(p).readOnly)
    .map(([name, p0]) => {
      const p = res(p0);
      const type = Array.isArray(p.type) ? p.type.join("|") : (p.type ?? (p.$ref ? "object" : p.oneOf || p.anyOf ? "oneOf" : "any"));
      const flags = [type + (p.format ? `:${p.format}` : ""), required.includes(name) ? "**obrigatório**" : "opcional"];
      if (p["x-nullable"]) flags.push("nullable");
      if (p.enum) flags.push(`enum: ${p.enum.filter((v: unknown) => v !== null).join(" / ")}`);
      const desc = String(p.description ?? p.title ?? "").replace(/\s+/g, " ").trim();
      return `- \`${name}\` (${flags.join(", ")})${desc ? ` — ${desc}` : ""}`;
    });
  return lines.length ? `\n\n### Campos do body\n${lines.join("\n")}` : "";
}

function responseDocs(responses: Json | undefined): string {
  if (!responses) return "";
  const lines = Object.entries<Json>(responses).map(
    ([code, r]) => `- **${code}** ${String(r.description ?? "").replace(/\s+/g, " ").trim()}`
  );
  return lines.length ? `\n\n### Respostas\n${lines.join("\n")}` : "";
}

// ---------------------------------------------------------------------------
// Montagem de request
// ---------------------------------------------------------------------------

type Param = { name: string; in: string; required?: boolean; description?: string; type?: string; schema?: Json; enum?: unknown[]; default?: unknown };

function buildUrl(base: string, path: string, params: Param[]): Json {
  // {id} → :id (variável de path do Postman)
  const pmPath = path.replace(/\{([^}]+)\}/g, ":$1");
  const segments = pmPath.split("/").filter(Boolean);
  const trailing = path.endsWith("/") ? "/" : "";
  const query = params
    .filter((p) => p.in === "query")
    .map((p) => {
      const enumVals = p.enum ?? p.schema?.enum;
      const extra = enumVals ? ` [${enumVals.join(" | ")}]` : "";
      return {
        key: p.name,
        value: "",
        description: `${(p.description ?? "").replace(/\s+/g, " ").trim()}${extra}`.trim(),
        disabled: true,
      };
    });
  const variable = params
    .filter((p) => p.in === "path")
    .map((p) => ({ key: p.name, value: "", description: (p.description ?? "").replace(/\s+/g, " ").trim() }));
  const raw = `{{${base}}}/${segments.join("/")}${trailing}`;
  return {
    raw,
    host: [`{{${base}}}`],
    path: trailing ? [...segments, ""] : segments,
    ...(query.length ? { query } : {}),
    ...(variable.length ? { variable } : {}),
  };
}

function jsonBody(value: unknown): Json {
  return { mode: "raw", raw: JSON.stringify(value, null, 2), options: { raw: { language: "json" } } };
}

// ---------------------------------------------------------------------------
// GSS (Swagger 2.0)
// ---------------------------------------------------------------------------

const GSS_CF_HEADERS = [
  { key: "CF-Access-Client-Id", value: "{{gss_cf_client_id}}", type: "text" },
  { key: "CF-Access-Client-Secret", value: "{{gss_cf_client_secret}}", type: "text" },
];

/** Pre-request do folder GSS: garante `gss_access` válido (refresh → login). */
const GSS_AUTO_TOKEN = [
  "// Garante um access token válido em {{gss_access}} antes de cada chamada do GSS.",
  "// Tenta o refresh; se não der, faz login com gss_username/gss_password.",
  "const url = pm.request.url.toString();",
  "if (!url.includes('/authentication/')) {",
  "  const v = (k) => pm.variables.replaceIn('{{' + k + '}}');",
  "  const expMs = (t) => { try { const p = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(atob(p)).exp * 1000; } catch (e) { return 0; } };",
  "  const access = pm.environment.get('gss_access');",
  "  if (!access || expMs(access) - Date.now() < 30000) {",
  "    const headers = [",
  "      { key: 'Content-Type', value: 'application/json' },",
  "      { key: 'CF-Access-Client-Id', value: v('gss_cf_client_id') },",
  "      { key: 'CF-Access-Client-Secret', value: v('gss_cf_client_secret') },",
  "    ];",
  "    const login = () => pm.sendRequest({",
  "      url: v('gss_base') + '/authentication/token/', method: 'POST', header: headers,",
  "      body: { mode: 'raw', raw: JSON.stringify({ username: v('gss_username'), password: v('gss_password') }) },",
  "    }, (err, res) => {",
  "      if (err || res.code !== 200) { console.warn('GSS login falhou', err || res.code, res && res.text()); return; }",
  "      const j = res.json();",
  "      pm.environment.set('gss_access', j.access);",
  "      if (j.refresh) pm.environment.set('gss_refresh', j.refresh);",
  "    });",
  "    const refresh = pm.environment.get('gss_refresh');",
  "    if (refresh && expMs(refresh) > Date.now()) {",
  "      pm.sendRequest({",
  "        url: v('gss_base') + '/authentication/token/refresh/', method: 'POST', header: headers,",
  "        body: { mode: 'raw', raw: JSON.stringify({ refresh }) },",
  "      }, (err, res) => {",
  "        if (!err && res.code === 200) pm.environment.set('gss_access', res.json().access);",
  "        else login();",
  "      });",
  "    } else login();",
  "  }",
  "}",
];

const GSS_SAVE_TOKENS = [
  "pm.test('200', () => pm.response.to.have.status(200));",
  "const j = pm.response.json();",
  "if (j.access) pm.environment.set('gss_access', j.access);",
  "if (j.refresh) pm.environment.set('gss_refresh', j.refresh);",
];

function gssFolderKey(path: string, tag: string): [string, string | null] {
  const seg = path.split("/").filter(Boolean);
  if (seg[0] === "core") return ["core", seg[1]];
  if (tag === "ETD Factories") return ["shipments / etd-factories", null];
  return [seg[0], null];
}

function buildGss(spec: Json): PmItem {
  const res = makeResolver(spec);
  const folders = new Map<string, Map<string | null, PmItem[]>>();
  let count = 0;

  for (const [path, pathItem] of Object.entries<Json>(spec.paths)) {
    const shared: Param[] = pathItem.parameters ?? [];
    for (const m of METHODS) {
      const op: Json | undefined = pathItem[m];
      if (!op) continue;
      count++;
      const params: Param[] = [...shared, ...(op.parameters ?? [])];
      const bodyParam = params.find((p) => p.in === "body");
      const formParams = params.filter((p) => p.in === "formData");
      const isAuth = path.startsWith("/authentication/");

      let body: Json | undefined;
      if (bodyParam?.schema) {
        const s = res(bodyParam.schema);
        let value = sampleValue(s, res, 0, true);
        if (path === "/authentication/token/") value = { username: "{{gss_username}}", password: "{{gss_password}}" };
        if (path === "/authentication/token/refresh/") value = { refresh: "{{gss_refresh}}" };
        if (path === "/authentication/token/verify/") value = { token: "{{gss_access}}" };
        body = jsonBody(m === "patch" && !isAuth ? {} : value);
      } else if (formParams.length) {
        body = {
          mode: "urlencoded",
          urlencoded: formParams.map((p) => ({ key: p.name, value: "", description: p.description ?? "", disabled: !p.required })),
        };
      }

      const desc = [
        op.summary && op.summary !== op.operationId ? `**${op.summary}**` : "",
        op.description ?? "",
        `\`operationId: ${op.operationId}\``,
      ]
        .filter(Boolean)
        .join("\n\n");

      const item: PmItem = {
        name: `${m.toUpperCase()} ${path}`,
        request: {
          method: m.toUpperCase(),
          header: [...GSS_CF_HEADERS, ...(body?.mode === "raw" ? [{ key: "Content-Type", value: "application/json", type: "text" }] : [])],
          ...(isAuth ? { auth: { type: "noauth" } } : {}),
          url: buildUrl("gss_base", path, params),
          ...(body ? { body } : {}),
          description: desc + fieldDocs(bodyParam?.schema, res) + responseDocs(op.responses),
        },
        ...(path === "/authentication/token/" || path === "/authentication/token/refresh/"
          ? { event: [{ listen: "test", script: { type: "text/javascript", exec: GSS_SAVE_TOKENS } }] }
          : {}),
      };

      const [top, sub] = gssFolderKey(path, op.tags?.[0] ?? "");
      if (!folders.has(top)) folders.set(top, new Map());
      const subs = folders.get(top)!;
      if (!subs.has(sub)) subs.set(sub, []);
      subs.get(sub)!.push(item);
    }
  }

  const order = ["authentication", "orders", "shipments", "shipments / etd-factories", "core", "commercial"];
  const tops = [...folders.keys()].sort((a, b) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99);
  const item = tops.map((top) => {
    const subs = folders.get(top)!;
    const children = [...subs.entries()].flatMap(([sub, items]) => (sub === null ? items : [{ name: sub, item: items }]));
    return { name: top, item: children };
  });

  console.log(`GSS: ${count} operações`);
  return {
    name: "1. GSS (api.gssdatahub.com/v1)",
    description:
      `Todas as ${count} operações do Swagger do GSS (${spec.info?.title} ${spec.info?.version}).\n\n` +
      "Auth: headers do Cloudflare Access em toda chamada + `Bearer {{gss_access}}`. O pre-request deste folder renova o token sozinho (refresh → login) — não precisa rodar o Login antes.\n\n" +
      "⚠️ Isto é a PRODUÇÃO do GSS: POST/PUT/PATCH/DELETE gravam de verdade. Rotas terminam com `/` (sem a barra o Django responde 301 e o Postman refaz como GET — volta a LISTA com 200).",
    auth: { type: "bearer", bearer: [{ key: "token", value: "{{gss_access}}", type: "string" }] },
    event: [{ listen: "prerequest", script: { type: "text/javascript", exec: GSS_AUTO_TOKEN } }],
    item,
  };
}

// ---------------------------------------------------------------------------
// SOTWISE (OpenAPI 3.1)
// ---------------------------------------------------------------------------

function buildSotwise(spec: Json): PmItem {
  const res = makeResolver(spec);
  const folders = new Map<string, Map<string | null, PmItem[]>>();
  let count = 0;

  for (const [path, pathItem] of Object.entries<Json>(spec.paths)) {
    const shared: Param[] = pathItem.parameters ?? [];
    for (const m of METHODS) {
      const op: Json | undefined = pathItem[m];
      if (!op) continue;
      count++;
      const params: Param[] = [...shared, ...(op.parameters ?? [])];
      const content: Json | undefined = op.requestBody?.content?.["application/json"];

      // Um request por exemplo nomeado; senão um só, com exemplo/obrigatórios.
      const variants: Array<{ suffix: string; value?: unknown; note?: string }> = [];
      if (content?.examples && Object.keys(content.examples).length) {
        for (const [key, ex] of Object.entries<Json>(content.examples)) {
          variants.push({ suffix: ` — ${key}`, value: ex.value, note: ex.summary });
        }
      } else if (content) {
        const value = content.example ?? (m === "patch" ? {} : sampleValue(res(content.schema), res, 0, true));
        variants.push({ suffix: "", value });
      } else {
        variants.push({ suffix: "" });
      }

      for (const v of variants) {
        const desc = [
          `**${op.summary ?? ""}**${v.note ? ` — exemplo: ${v.note}` : ""}`,
          op.description ?? "",
          op.operationId ? `\`operationId: ${op.operationId}\`` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        const item: PmItem = {
          name: `${m.toUpperCase()} ${path}${v.suffix}`,
          request: {
            method: m.toUpperCase(),
            header: content ? [{ key: "Content-Type", value: "application/json", type: "text" }] : [],
            url: buildUrl("base_url", path, params),
            ...(content ? { body: jsonBody(v.value ?? {}) } : {}),
            description: desc + fieldDocs(content?.schema, res) + responseDocs(op.responses),
          },
        };

        const tag = op.tags?.[0] ?? "Outros";
        const sub = tag === "Libraries" ? path.split("/").filter(Boolean)[1] : null;
        if (!folders.has(tag)) folders.set(tag, new Map());
        const subs = folders.get(tag)!;
        if (!subs.has(sub)) subs.set(sub, []);
        subs.get(sub)!.push(item);
      }
    }
  }

  const tagOrder: string[] = (spec.tags ?? []).map((t: Json) => t.name);
  const item = [...folders.keys()]
    .sort((a, b) => tagOrder.indexOf(a) - tagOrder.indexOf(b))
    .map((tag) => {
      const subs = folders.get(tag)!;
      const children = [...subs.entries()].flatMap(([sub, items]) => (sub === null ? items : [{ name: sub, item: items }]));
      const tagDesc = (spec.tags ?? []).find((t: Json) => t.name === tag)?.description ?? "";
      return { name: tag, description: tagDesc, item: children };
    });

  console.log(`SOTWISE: ${count} operações`);
  return {
    name: "2. SOTWISE (/api — o nosso Swagger)",
    description:
      `Todas as ${count} operações de \`/api/openapi.json\` (Swagger UI em \`{{base_url}}/api/docs\`).\n\n` +
      "Auth: `Bearer {{api_token}}` (o `API_TOKEN` da Vercel). ⚠️ `base_url` = produção por padrão: POST/PATCH/DELETE gravam de verdade.",
    auth: { type: "bearer", bearer: [{ key: "token", value: "{{api_token}}", type: "string" }] },
    item,
  };
}

// ---------------------------------------------------------------------------

async function main() {
  const r = await gssGet<Json>("/openapi.json");
  if (!r.ok) {
    console.error("❌ Não consegui baixar o Swagger do GSS:", r.error);
    process.exit(1);
  }

  const collection = {
    info: {
      name: "SOTWISE x GSS — Swagger completo",
      description:
        "Gerada por `scripts/postman/build-swagger-collection.ts` a partir dos dois Swaggers (GSS ao vivo + domain/api/openapi.ts). " +
        "Não editar à mão: rodar o script de novo quando algum dos specs mudar.\n\n" +
        "Corpos de exemplo trazem só os campos obrigatórios (PATCH vem `{}`); a lista completa de campos está na aba Docs de cada request. " +
        "Query params vêm todos desmarcados; variáveis de path (`:id`, `:pl_number`…) vêm vazias.\n\n" +
        `Gerada em ${new Date().toISOString().slice(0, 10)}.`,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: [buildGss(r.data), buildSotwise(openApiSpec as unknown as Json)],
  };

  writeFileSync(OUT, JSON.stringify(collection, null, 2) + "\n");
  console.log(`✅ ${OUT}`);
}

main();
