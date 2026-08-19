import { createHash, timingSafeEqual } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_OPTIONS, runSync, willInsert, type JunctionPlan, type ResourcePlan, type SyncOptions } from "@/lib/gss/sync";

/**
 * Sync agendado GSS → SOTWISE (docs/INTEGRACAO_GSS.md §9).
 *
 * O motor é o mesmo do CLI (`scripts/sync-gss/sync.ts`) — aqui só entram a
 * autorização do agendador e a política de escrita.
 *
 * Chamada pelo Vercel Cron (vercel.json), que manda `Authorization: Bearer
 * $CRON_SECRET` num GET. `?dry=1` roda o plano inteiro sem gravar, útil para
 * conferir em produção sem efeito colateral.
 */

// O pull lê ~10 endpoints sem paginação (o maior traz 698 linhas) e escreve em
// lotes; o limite real de cada plano da Vercel se aplica por cima deste número.
export const maxDuration = 300;

/**
 * Política de escrita do agendado (§9.7). Campos e vínculos sempre; INSERT só
 * de geografia, porque `factories`/`categories` esperam a fila de merge — antes
 * dela, o "novo" do GSS pode ser a terceira cópia de algo já duplicado aqui.
 * `softDelete` fica desligado: sem `deleted_at` na origem, sumiço é inferido por
 * diferença de conjunto, e uma falha parcial da API viraria exclusão em massa.
 */
const CRON_POLICY: Partial<SyncOptions> = {
  insertOnly: new Set(["countries", "cities"]),
  softDelete: false,
};

/** Compara em tempo constante, sem depender de os tamanhos baterem. */
function secretMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function summarize(p: ResourcePlan, opts: SyncOptions) {
  const writes = willInsert(p.table, opts);
  return {
    resource: p.table,
    matched: p.matched,
    linked: p.links.length,
    fieldsUpdated: p.fields.length,
    revived: p.revives.length,
    inserted: writes ? p.inserts.length : 0,
    insertsHeld: writes ? 0 : p.inserts.length,
    // "sumiu do GSS": só relatado, nunca aplicado por aqui.
    missing: p.missing.length,
    duplicateGroups: p.dupesAll.length,
  };
}

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return Response.json({ error: "CRON_SECRET not configured." }, { status: 503 });
  }
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !secretMatches(token, expected)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const dry = new URL(request.url).searchParams.get("dry") === "1";
  const startedAt = Date.now();

  const opts: SyncOptions = { ...DEFAULT_OPTIONS, ...CRON_POLICY, commit: !dry };

  try {
    const { resources: plans, junctions } = await runSync(createAdminClient(), opts);
    const total = (f: (p: ResourcePlan) => number) => plans.reduce((s, p) => s + f(p), 0);
    const jTotal = (f: (j: JunctionPlan) => number) => junctions.reduce((s, j) => s + f(j), 0);
    return Response.json({
      ok: true,
      dry,
      durationMs: Date.now() - startedAt,
      totals: {
        linked: total((p) => p.links.length),
        fieldsUpdated: total((p) => p.fields.length),
        revived: total((p) => p.revives.length),
        missing: total((p) => p.missing.length),
        // junções: insert é padrão; delete só relatado (softDelete off na política).
        junctionLinked: jTotal((j) => j.inserts.length),
        junctionRemovable: jTotal((j) => j.deletes.length),
      },
      resources: plans.map((p) => summarize(p, opts)),
      junctions: junctions.map((j) => ({
        junction: j.table,
        desired: j.desired,
        current: j.current,
        matched: j.matched,
        inserted: j.inserts.length,
        removable: j.deletes.length,
        unresolved: j.unresolved,
      })),
    });
  } catch (error) {
    // `gss_sync_state` já registrou o erro no recurso que falhou (o motor grava
    // antes de propagar), então aqui basta devolver 500 para o agendador.
    const message = error instanceof Error ? error.message : String(error);
    console.error("[cron/sync-gss]", message);
    return Response.json({ ok: false, error: message, durationMs: Date.now() - startedAt }, { status: 500 });
  }
}
