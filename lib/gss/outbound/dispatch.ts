/**
 * Despachante da fila `gss_outbound` (docs/INTEGRACAO_GSS.md §10).
 *
 * A CAPTURA é dos triggers (migration 20261002120000); aqui é só a ENTREGA:
 * reivindica linhas vencidas pela RPC `claim_gss_outbound` (SKIP LOCKED, sem
 * envio duplo), monta o payload com o estado atual e carimba o resultado.
 *
 * Política por resultado (`GssWriteKind`, lib/gss/client.ts):
 *   ok        → sent
 *   permanent → failed, com o corpo do GSS em last_error (repetir igual não muda)
 *   retryable → pending com espera de 2^attempts min (teto 6h); na 8ª, failed
 *   blocked   → pending em 15 min, SEM contar tentativa (não é culpa do dado)
 *
 * Sem `server-only` e com imports relativos: também roda no CLI
 * (scripts/sync-gss/push-outbound.ts). O agendamento pós-resposta (after())
 * fica em ./schedule.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../../types/database";
import { pushPlShipment } from "./pl-shipment";

type DB = SupabaseClient<Database>;
type OutboundRow = Database["public"]["Tables"]["gss_outbound"]["Row"];
type OutboundUpdate = Database["public"]["Tables"]["gss_outbound"]["Update"];

const BATCH_LIMIT = 25;
const MAX_ATTEMPTS = 8;
const MAX_BACKOFF_MIN = 360;
const BLOCKED_WAIT_MIN = 15;

/** Chave geral: sem ela os triggers seguem enfileirando, mas nada sai. */
export function gssOutboundEnabled(): boolean {
  return process.env.GSS_OUTBOUND_ENABLED === "true";
}

export type OutboundDispatchResult = {
  enabled: boolean;
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Voltaram para `pending` (retryable/blocked) — saem num próximo disparo. */
  postponed: number;
  errors: string[];
};

function minutesFromNow(min: number): string {
  return new Date(Date.now() + min * 60_000).toISOString();
}

/**
 * Grava o desfecho. Voltar a `pending` pode bater no índice único parcial se,
 * enquanto esta linha estava em `sending`, um save novo enfileirou outra: aí a
 * nova já cobre (o payload é montado na hora), e esta sai como `skipped`.
 */
async function settle(db: DB, id: string, values: OutboundUpdate): Promise<void> {
  const { error } = await db.from("gss_outbound").update({ ...values, locked_until: null }).eq("id", id);
  if (error?.code === "23505" && values.status === "pending") {
    await db
      .from("gss_outbound")
      .update({ status: "skipped", locked_until: null, last_error: "substituída por um envio mais novo do mesmo PL" })
      .eq("id", id);
    return;
  }
  if (error) throw new Error(`gss_outbound update: ${error.message}`);
}

async function processRow(db: DB, row: OutboundRow, result: OutboundDispatchResult): Promise<void> {
  if (row.kind !== "pl_shipment") {
    await settle(db, row.id, { status: "skipped", last_error: `kind desconhecido: ${row.kind}` });
    result.skipped += 1;
    return;
  }

  let push: Awaited<ReturnType<typeof pushPlShipment>>;
  try {
    push = await pushPlShipment(db, row.entity_id);
  } catch (err) {
    // Falha lendo o NOSSO banco: trata como transitória.
    const attempts = row.attempts + 1;
    const message = err instanceof Error ? err.message : String(err);
    await settle(db, row.id, {
      status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
      attempts,
      next_attempt_at: minutesFromNow(Math.min(2 ** attempts, MAX_BACKOFF_MIN)),
      last_error: message.slice(0, 1000),
    });
    result.errors.push(message);
    if (attempts >= MAX_ATTEMPTS) result.failed += 1;
    else result.postponed += 1;
    return;
  }

  if (push.outcome === "skipped") {
    await settle(db, row.id, { status: "skipped", last_error: push.reason });
    result.skipped += 1;
    return;
  }
  if (push.outcome === "planned") return; // só no modo dry, que não passa por aqui

  const { call, result: r } = push;
  const audit: OutboundUpdate = {
    request: { method: call.method, path: call.path, body: call.body },
    response_status: r.status || null,
    response_body: r.text || null,
  };

  if (r.kind === "ok") {
    await settle(db, row.id, {
      ...audit,
      status: "sent",
      attempts: row.attempts + 1,
      sent_at: new Date().toISOString(),
      last_error: null,
    });
    result.sent += 1;
    return;
  }

  if (r.kind === "permanent") {
    await settle(db, row.id, { ...audit, status: "failed", attempts: row.attempts + 1, last_error: r.error ?? null });
    result.failed += 1;
    result.errors.push(r.error ?? `GSS ${r.status}`);
    return;
  }

  if (r.kind === "blocked") {
    await settle(db, row.id, {
      ...audit,
      status: "pending",
      next_attempt_at: minutesFromNow(BLOCKED_WAIT_MIN),
      last_error: r.error ?? "blocked",
    });
    result.postponed += 1;
    result.errors.push(r.error ?? "blocked");
    return;
  }

  // retryable
  const attempts = row.attempts + 1;
  const exhausted = attempts >= MAX_ATTEMPTS;
  await settle(db, row.id, {
    ...audit,
    status: exhausted ? "failed" : "pending",
    attempts,
    next_attempt_at: minutesFromNow(Math.min(2 ** attempts, MAX_BACKOFF_MIN)),
    last_error: r.error ?? `GSS ${r.status}`,
  });
  if (exhausted) result.failed += 1;
  else result.postponed += 1;
  result.errors.push(r.error ?? `GSS ${r.status}`);
}

/**
 * Drena a fila. `force` ignora a chave `GSS_OUTBOUND_ENABLED` — só para o CLI
 * (`--commit` é uma ação deliberada); o app nunca passa `force`.
 */
export async function dispatchGssOutbound(
  db: DB,
  opts: { force?: boolean; limit?: number; maxRounds?: number } = {}
): Promise<OutboundDispatchResult> {
  const result: OutboundDispatchResult = {
    enabled: gssOutboundEnabled(),
    claimed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    postponed: 0,
    errors: [],
  };
  if (!result.enabled && !opts.force) return result;

  const limit = opts.limit ?? BATCH_LIMIT;
  for (let round = 0; round < (opts.maxRounds ?? 1); round++) {
    const { data: rows, error } = await db.rpc("claim_gss_outbound", { p_limit: limit });
    if (error) {
      result.errors.push(`claim_gss_outbound: ${error.message}`);
      break;
    }
    const claimed = (rows ?? []) as OutboundRow[];
    result.claimed += claimed.length;
    for (const row of claimed) {
      try {
        await processRow(db, row, result);
      } catch (err) {
        // Falha ao carimbar: a trava de 5 min devolve a linha à fila sozinha.
        result.errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    if (claimed.length < limit) break;
  }
  return result;
}
