import { createHash, timingSafeEqual } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_OPTIONS,
  isSyncStepKey,
  runSync,
  runSyncStep,
  SYNC_STEP_KEYS,
  willInsert,
  type JunctionPlan,
  type ResourcePlan,
  type SyncOptions,
} from "@/lib/gss/sync";
import { dispatchGssOutbound } from "@/lib/gss/outbound/dispatch";
import { ordersPullEnabled, runOrdersSync } from "@/lib/gss/sync-orders";

/**
 * Sync agendado GSS → SOTWISE (docs/INTEGRACAO_GSS.md §9).
 *
 * O motor é o mesmo do CLI (`scripts/sync-gss/sync.ts`) — aqui só entram a
 * autorização do agendador e a política de escrita.
 *
 * Chamada pelo Vercel Cron (vercel.json), que manda `Authorization: Bearer
 * $CRON_SECRET` num GET. Um cron por biblioteca (§9.12), cada um no próprio
 * caminho — `/api/cron/sync-gss/<passo>` (chaves de `SYNC_STEPS`) roda só aquela
 * e `/api/cron/sync-gss/orders` roda Orders + Lotes + a via de saída. Caminho e
 * não query string porque é o `path` que a Vercel agenda. Sem passo
 * (`/api/cron/sync-gss`), roda tudo em sequência, como antes (Run manual).
 * `?dry=1` roda o plano sem gravar, útil para conferir em produção sem efeito
 * colateral.
 *
 * As duas rotas (`route.ts` e `[lib]/route.ts`) só leem o passo e chamam aqui.
 */

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

/**
 * Batimento do próprio agendado, na linha `cron` de `gss_sync_state` (e nas
 * linhas `orders`/`batches`). Com um cron por biblioteca, o batimento de cada
 * uma é a própria linha dela — o motor grava "ok" ou o erro da leitura
 * (`runSyncStep`); a linha `cron` só marca a execução completa, sem `lib`.
 */
async function recordCronRun(
  sb: ReturnType<typeof createAdminClient>,
  error?: string,
  resource = "cron",
  rows = 0
): Promise<void> {
  const now = new Date().toISOString();
  const { error: e } = await sb.from("gss_sync_state").upsert(
    {
      resource,
      last_run_at: now,
      last_status: error ? "error" : "ok",
      last_error: error ?? null,
      rows_upserted: rows,
      updated_at: now,
    },
    { onConflict: "resource" }
  );
  if (e) console.warn(`gss_sync_state ${resource}: ${e.message}`);
}

/**
 * Orders e lotes (lib/gss/sync-orders.ts). Falha aqui não derruba o resto: fica
 * na linha `orders` de gss_sync_state e na resposta. Travado
 * (GSS_ORDERS_PULL_ENABLED ausente), só lê e devolve o plano.
 */
async function pullOrders(sb: ReturnType<typeof createAdminClient>, dry: boolean) {
  const locked = !ordersPullEnabled();
  const writeOrders = !dry && !locked;
  return runOrdersSync(sb, { commit: writeOrders })
    .then(async (r) => {
      if (writeOrders) {
        const { orders: o, batches: b } = r;
        await recordCronRun(sb, r.logError, "orders", o.created + o.updated + o.linked);
        await recordCronRun(sb, undefined, "batches", b.created + b.updated + b.linked);
      }
      return { ...r, locked };
    })
    .catch(async (e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[cron/sync-gss] orders", message);
      if (writeOrders) await recordCronRun(sb, message, "orders");
      return { error: message, locked };
    });
}

export async function handleSyncGss(request: Request, lib: string | null): Promise<Response> {
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
  const step = lib !== null && isSyncStepKey(lib) ? lib : null;
  if (lib !== null && lib !== "orders" && !step) {
    return Response.json(
      { error: `Unknown lib "${lib}". Use one of: ${[...SYNC_STEP_KEYS, "orders"].join(", ")}.` },
      { status: 400 }
    );
  }
  const startedAt = Date.now();

  const opts: SyncOptions = { ...DEFAULT_OPTIONS, ...CRON_POLICY, commit: !dry };
  const sb = createAdminClient();

  try {
    // Bibliotecas: uma (`lib`), nenhuma (`lib=orders`) ou todas (sem `lib`).
    const { resources: plans, junctions } =
      lib === "orders"
        ? { resources: [] as ResourcePlan[], junctions: [] as JunctionPlan[] }
        : step
          ? await runSyncStep(sb, step, opts)
          : await runSync(sb, opts);
    if (!dry && !lib) await recordCronRun(sb);

    // Orders depois das bibliotecas, para os nomes de cliente/exporter já
    // estarem atualizados — no agendado, o cron de orders é o último do dia.
    const withOrders = !lib || lib === "orders";
    const orders = withOrders ? await pullOrders(sb, dry) : null;
    // Rede de segurança da via de saída (§10): o que nenhuma action despachou
    // sai aqui. Falha do envio não derruba o pull — fica registrada na fila.
    const outbound = dry || !withOrders ? null : await dispatchGssOutbound(sb, { maxRounds: 8 }).catch((e: unknown) => ({
      error: e instanceof Error ? e.message : String(e),
    }));
    const total = (f: (p: ResourcePlan) => number) => plans.reduce((s, p) => s + f(p), 0);
    const jTotal = (f: (j: JunctionPlan) => number) => junctions.reduce((s, j) => s + f(j), 0);
    return Response.json({
      ok: true,
      dry,
      lib: lib ?? "all",
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
      orders,
      outbound,
    });
  } catch (error) {
    // Se a falha foi num passo, o motor já gravou o erro nas linhas dele; a
    // linha `cron` só registra a execução completa.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[cron/sync-gss${lib ? ` ${lib}` : ""}]`, message);
    if (!dry && !lib) await recordCronRun(sb, message);
    return Response.json({ ok: false, lib: lib ?? "all", error: message, durationMs: Date.now() - startedAt }, { status: 500 });
  }
}
