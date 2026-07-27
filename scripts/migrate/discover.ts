/**
 * Discovery de schema dos data types do Bubble.
 * Amostra várias linhas por type (o Bubble omite campos vazios por registro),
 * une as chaves e infere o tipo de cada campo — sem imprimir VALORES (privacidade).
 * Uso: npx tsx scripts/migrate/discover.ts
 * Salva o inventário em scripts/migrate/_discovery.json.
 */
import { writeFileSync } from "fs";
import { fetchAll } from "./bubble";

const TYPES = [
  "user", "clients", "agents", "agentscontacts", "contacts", "carrier", "factory",
  "category", "cities", "pol", "pod", "businessunit", "ordertype", "shipmentmodel",
  "exporters", "[vistapub]order", "[vistapub]orderxlotexpl",
  "[vistapub]listoffactoriesxcategoriesxlote", "[vistapub]checklist", "[vistapub]checklistxitem",
  "[vistapub]checklistxitemxagents", "[vistapub]pre-loading", "[vistapub]shippment",
  "shipment_parts", "[vistapub]etdfactorieslogs", "shipping", "status",
  "[vistapub]generaldocs", "reportpendingtask", "db",
];

const BUBBLE_ID = /^\d+x\d+$/;

function jsType(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return `array<${v.length ? jsType(v[0]) : "?"}>`;
  if (typeof v === "object") return "object";
  if (typeof v === "string") return BUBBLE_ID.test(v) ? "id-ref" : "string";
  return typeof v;
}

async function main() {
  const SAMPLE = 200;
  const inventory: Record<string, { count: number; fields: Record<string, Set<string>> }> = {};

  for (const type of TYPES) {
    try {
      const rows = await fetchAll(type, { max: SAMPLE });
      const fields: Record<string, Set<string>> = {};
      for (const row of rows) {
        for (const [k, v] of Object.entries(row)) {
          (fields[k] ??= new Set()).add(jsType(v));
        }
      }
      inventory[type] = { count: rows.length, fields };
      const cols = Object.entries(fields)
        .map(([k, set]) => `${k}:${[...set].join("|")}`)
        .join(", ");
      console.log(`\n### ${type}  (amostra ${rows.length})\n${cols}`);
    } catch (e) {
      console.log(`\n### ${type}  ERRO: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  const serializable = Object.fromEntries(
    Object.entries(inventory).map(([t, { count, fields }]) => [
      t,
      { count, fields: Object.fromEntries(Object.entries(fields).map(([k, s]) => [k, [...s]])) },
    ]),
  );
  writeFileSync("scripts/migrate/_discovery.json", JSON.stringify(serializable, null, 2));
  console.log("\n\n→ inventário salvo em scripts/migrate/_discovery.json");
}

main().catch((e) => {
  console.error("FALHOU:", e);
  process.exit(1);
});
