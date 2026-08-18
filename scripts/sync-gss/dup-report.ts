/**
 * RELATÓRIO (só leitura) de duplicatas por nome em TODAS as bibliotecas.
 * Não escreve nada no banco — gera um .xlsx para o Henrique decidir a ação.
 *
 *   npx tsx scripts/sync-gss/dup-report.ts [caminho-de-saida.xlsx]
 *
 * Agrupa por nome normalizado (mesma norm() do sync). Grupos com 2+ linhas são
 * relatados. Onde há grafo de FK conhecido, conta o uso (refs) para expor o que é
 * lixo 0-uso. Classifica cada grupo: placeholder / multi-gss (humano) / dup real.
 * Regra do sobrevivente é a mesma do merge-libraries (gss_id > mais usada).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { norm } from "../../lib/gss/sync";

const OUT = process.argv[2] ?? "dup-report.xlsx";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
}) as any;

// Todas as bibliotecas (INTEGRACAO_GSS §1.1).
const LIBS = [
  "countries", "cities", "pols", "pods", "factories", "categories", "contacts",
  "agents", "carriers", "clients", "exporters", "business_units", "order_types",
  "shipment_models",
];

// Grafo de FK por tabela (para contar uso). `self` = coluna que aponta pra ESTA lib.
type Ref = { table: string; col: string };
const REFS: Record<string, Ref[]> = {
  factories: [
    { table: "order_factory_category", col: "factory_id" },
    { table: "etd_info", col: "dispatch_location_id" },
    { table: "step_attachments", col: "factory_id" },
    { table: "pre_loading_checklist_steps", col: "consolidation_point_id" },
    { table: "category_factories", col: "factory_id" },
  ],
  categories: [
    { table: "order_factory_category", col: "category_id" },
    { table: "category_factories", col: "category_id" },
  ],
  contacts: [
    { table: "pre_loading_checklist_steps", col: "contact_brazil_id" },
    { table: "pre_loading_checklist_steps", col: "contact_china_id" },
    { table: "agent_contacts", col: "contact_id" },
  ],
  agents: [
    { table: "pre_loading_checklist_steps", col: "agent_brazil_id" },
    { table: "pre_loading_checklist_steps", col: "agent_china_id" },
    { table: "pre_loading_checklist_steps", col: "carrier_agent_id" },
    { table: "agent_contacts", col: "agent_id" },
    { table: "carrier_agents", col: "agent_id" },
  ],
  pols: [
    { table: "pre_loading_checklist_steps", col: "pol_id" },
    { table: "city_pols", col: "pol_id" },
  ],
  cities: [
    { table: "pre_loading_checklist_steps", col: "city_id" },
    { table: "city_pols", col: "city_id" },
  ],
};

const PLACEHOLDER = new Set(["", "n/a", "na", "n.a.", "n.a", "none", "null", "tbd", "-", "--", "?", "."]);

type Row = { id: string; name: string | null; gss_id: string | null };

async function fetchAll<T>(table: string, cols: string, tweak?: (q: any) => any): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from(table).select(cols).range(from, from + PAGE - 1);
    if (tweak) q = tweak(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function refCounts(lib: string): Promise<Map<string, number>> {
  const count = new Map<string, number>();
  for (const { table, col } of REFS[lib] ?? []) {
    let rows: Record<string, string | null>[];
    try {
      rows = await fetchAll(table, col);
    } catch (e) {
      console.warn(`  (aviso: não consegui contar ${table}.${col}: ${(e as Error).message})`);
      continue;
    }
    for (const r of rows) {
      const v = r[col];
      if (v) count.set(v, (count.get(v) ?? 0) + 1);
    }
  }
  return count;
}

type OutRow = {
  tabela: string;
  grupo: number;
  nome: string;
  detalhe: string; // o que distingue linhas de mesmo nome (cidade do pol, tel/email do contato)
  id: string;
  tem_gss_id: string;
  gss_id: string;
  refs: number | string;
  classificacao: string;
  papel_sugerido: string;
};

/** Mapa id→texto que ajuda a distinguir duplicatas de mesmo nome. */
async function detalhePorId(lib: string): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  if (lib === "contacts") {
    const rows = await fetchAll<{ id: string; phone_number: string | null; email: string | null }>(
      "contacts",
      "id, phone_number, email",
      (q) => q.is("deleted_at", null)
    );
    for (const r of rows) {
      const parts = [r.phone_number, r.email].filter((x) => x && String(x).trim());
      m.set(r.id, parts.join(" · ") || "(sem tel/email)");
    }
  } else if (lib === "pols" || lib === "cities") {
    const cities = await fetchAll<{ id: string; name: string }>("cities", "id, name");
    const cityName = new Map(cities.map((c) => [c.id, c.name]));
    const cp = await fetchAll<{ pol_id: string; city_id: string }>("city_pols", "pol_id, city_id");
    const key = lib === "pols" ? "pol_id" : "city_id";
    const val = lib === "pols" ? "city_id" : "pol_id";
    for (const r of cp) {
      const label = lib === "pols" ? cityName.get(r.city_id) ?? r.city_id : "";
      const cur = m.get((r as any)[key]);
      m.set((r as any)[key], cur ? `${cur}, ${label}` : label);
    }
    void val;
  }
  return m;
}

type Summary = {
  tabela: string;
  linhas: number;
  nomes_distintos: number;
  grupos_dup: number;
  copias_extra: number;
  grupos_placeholder: number;
  grupos_multi_gss: number;
};

async function main() {
  const detail: OutRow[] = [];
  const summary: Summary[] = [];
  let grupoSeq = 0;

  for (const lib of LIBS) {
    let rows: Row[];
    try {
      rows = await fetchAll<Row>(lib, "id, name, gss_id", (q) => q.is("deleted_at", null));
    } catch (e) {
      // tabela pode não ter gss_id — tenta sem
      try {
        rows = (await fetchAll<{ id: string; name: string | null }>(lib, "id, name", (q) =>
          q.is("deleted_at", null)
        )).map((r) => ({ ...r, gss_id: null }));
      } catch (e2) {
        console.warn(`pulei ${lib}: ${(e2 as Error).message}`);
        continue;
      }
    }

    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const k = norm(r.name);
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
    }

    const refs = REFS[lib] ? await refCounts(lib) : new Map<string, number>();
    const hasRefGraph = !!REFS[lib];
    // só vale a pena buscar detalhe se a tabela tem grupo duplicado
    const temDup = [...groups.values()].some((g) => g.length >= 2);
    const det = temDup ? await detalhePorId(lib) : new Map<string, string>();

    let gruposDup = 0, copiasExtra = 0, gPlaceholder = 0, gMultiGss = 0;

    for (const [k, g] of groups) {
      if (g.length < 2) continue;
      gruposDup++;
      copiasExtra += g.length - 1;

      const isPlaceholder = PLACEHOLDER.has(k);
      const comGss = g.filter((r) => r.gss_id);
      const gssDistintos = new Set(comGss.map((r) => r.gss_id)).size;
      const multiGss = gssDistintos >= 2;
      if (isPlaceholder) gPlaceholder++;
      if (multiGss) gMultiGss++;

      const classificacao = isPlaceholder
        ? "PLACEHOLDER (revisar à mão)"
        : multiGss
          ? "MULTI-GSS (decisão humana §9.4)"
          : "dup real (mergeável)";

      // sobrevivente sugerido (não aplica a placeholder/multi-gss)
      let survivorId: string | null = null;
      if (!isPlaceholder && !multiGss) {
        survivorId =
          comGss[0]?.id ??
          [...g].sort(
            (a, b) => (refs.get(b.id) ?? 0) - (refs.get(a.id) ?? 0) || a.id.localeCompare(b.id)
          )[0].id;
      }

      grupoSeq++;
      const ordered = [...g].sort((a, b) => (refs.get(b.id) ?? 0) - (refs.get(a.id) ?? 0));
      for (const r of ordered) {
        const papel = isPlaceholder
          ? "revisar"
          : multiGss
            ? "decidir"
            : r.id === survivorId
              ? "SOBREVIVE"
              : "cópia → some";
        detail.push({
          tabela: lib,
          grupo: grupoSeq,
          nome: r.name ?? "(em branco)",
          detalhe: det.get(r.id) ?? "",
          id: r.id,
          tem_gss_id: r.gss_id ? "sim" : "não",
          gss_id: r.gss_id ?? "",
          refs: hasRefGraph ? (refs.get(r.id) ?? 0) : "—",
          classificacao,
          papel_sugerido: papel,
        });
      }
    }

    summary.push({
      tabela: lib,
      linhas: rows.length,
      nomes_distintos: groups.size,
      grupos_dup: gruposDup,
      copias_extra: copiasExtra,
      grupos_placeholder: gPlaceholder,
      grupos_multi_gss: gMultiGss,
    });
    console.log(
      `${lib.padEnd(16)} linhas=${rows.length}  dup-grupos=${gruposDup}  cópias-extra=${copiasExtra}` +
        (gPlaceholder ? `  placeholder=${gPlaceholder}` : "") +
        (gMultiGss ? `  multi-gss=${gMultiGss}` : "")
    );
  }

  const wb = XLSX.utils.book_new();
  const wsResumo = XLSX.utils.json_to_sheet(summary);
  XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");
  const wsDet = XLSX.utils.json_to_sheet(detail);
  XLSX.utils.book_append_sheet(wb, wsDet, "Duplicatas");
  XLSX.writeFile(wb, OUT);
  console.log(`\n✔ ${OUT}  (${detail.length} linhas em ${summary.length} tabelas)`);
}

main().catch((e) => {
  console.error("FALHOU:", e);
  process.exit(1);
});
