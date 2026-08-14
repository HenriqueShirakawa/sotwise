/**
 * Vínculos aprovados NA MÃO (INTEGRACAO_GSS §9.9).
 *
 *   npx tsx scripts/sync-gss/link-aprovados.ts            # dry-run
 *   npx tsx scripts/sync-gss/link-aprovados.ts --commit
 *
 * O motor só pareia por nome exato. Estes aqui são os casos em que o cadastro
 * manual escreveu o mesmo nome de dois jeitos — revisados um a um em 14/08/2026
 * com a categoria de produto e a cidade como prova (ver a fila em
 * `review-similares.ts`). Ficam em código, versionados, porque um vínculo
 * decidido por gente precisa de rastro: quem, quando e com base em quê.
 *
 * Idempotente: pula o que já está vinculado e recusa nome ambíguo.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";
import type { LibTable } from "../../lib/gss/sync";

const COMMIT = process.argv.includes("--commit");

type Aprovado = { table: LibTable; gssId: string; localName: string; prova: string };

const APROVADOS: Aprovado[] = [
  // categoria de produto igual dos dois lados
  { table: "factories", gssId: "363", localName: "Chuangxiang", prova: "ambos Carburetor (Wenzhou)" },
  { table: "factories", gssId: "199", localName: "Zhejiang Kreation", prova: "ambos Sensor (Huzhou)" },
  { table: "factories", gssId: "96", localName: "Fenguang", prova: "Body parts + Headlight/Taillight" },
  { table: "factories", gssId: "535", localName: "Fenying", prova: "ambos Seat" },
  { table: "factories", gssId: "345", localName: "Hai wang", prova: "ambos Equipment and Machine" },
  { table: "factories", gssId: "153", localName: "Jinchum", prova: "ambos Equipment and Machine" },
  // únicos dos dois lados
  { table: "clients", gssId: "35", localName: "L.lopes", prova: "único 'Lopes' de cada lado" },
  { table: "clients", gssId: "38", localName: "Marquinhos", prova: "único 'Marquinho' de cada lado" },
  { table: "carriers", gssId: "1", localName: "MSC - Mediterranean Shg Co", prova: "sigla vs razão social; 19 embarques" },
  { table: "order_types", gssId: "4", localName: "Samples", prova: "singular vs plural; 77 orders" },
  // decisão de negócio do Henrique (14/08/2026): o nosso "Movile" sem sufixo é a
  // unidade do Amazonas. O GSS separa AM (#45) e SP (#46); o nosso "Movile - SP"
  // já pareou sozinho com o #46.
  { table: "clients", gssId: "45", localName: "Movile", prova: "decisão do Henrique: é a unidade AM" },
];

const sb = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function main() {
  console.log(`\n== Vínculos aprovados na mão [${COMMIT ? "COMMIT" : "DRY-RUN"}] ==\n`);
  let ok = 0, pulados = 0, problemas = 0;

  for (const a of APROVADOS) {
    // cast: nome de tabela em união colapsa os tipos do builder para `never`
    const q = sb.from(a.table) as unknown as {
      select: (c: string) => {
        eq: (c: string, v: string) => { is: (c: string, v: null) => Promise<{ data: { id: string; gss_id: string | null }[] | null; error: { message: string } | null }> };
      };
      update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> };
    };
    const { data, error } = await q.select("id, gss_id").eq("name", a.localName).is("deleted_at", null);
    if (error) { console.log(`✗ ${a.table} "${a.localName}": ${error.message}`); problemas++; continue; }
    const rows = data ?? [];
    if (rows.length !== 1) {
      console.log(`✗ ${a.table} "${a.localName}": ${rows.length} linhas (esperava 1) — não toco`);
      problemas++;
      continue;
    }
    const row = rows[0];
    if (row.gss_id === a.gssId) { console.log(`· ${a.table.padEnd(12)} "${a.localName}" já vinculado a #${a.gssId}`); pulados++; continue; }
    if (row.gss_id) {
      console.log(`✗ ${a.table} "${a.localName}" já aponta para #${row.gss_id}, não para #${a.gssId} — não sobrescrevo`);
      problemas++;
      continue;
    }
    console.log(`✓ ${a.table.padEnd(12)} "${a.localName}" → GSS #${a.gssId}   (${a.prova})`);
    if (COMMIT) {
      const { error: e } = await q.update({ gss_id: a.gssId }).eq("id", row.id);
      if (e) { console.log(`   ERRO ao gravar: ${e.message}`); problemas++; continue; }
    }
    ok++;
  }

  console.log(`\n${ok} ${COMMIT ? "gravados" : "a gravar"}, ${pulados} já vinculados, ${problemas} com problema.`);
  if (!COMMIT) console.log("Rode com --commit para gravar.");
}

main().catch((e) => { console.error("FALHOU:", e); process.exit(1); });
