/**
 * PL/Shipment do SOTWISE → `/v1/shipments/` do GSS (docs/INTEGRACAO_GSS.md §10).
 *
 * O GSS junta PL e Shipment num registro só, chaveado pelo `pl_number` inteiro.
 * Aqui o estado está espalhado em `pre_loadings`, `shipments` e no checklist
 * único do PL (`pre_loading_checklist_steps`), e é lido NA HORA do envio: a fila
 * guarda só "o PL X mudou", então sempre vai o último valor.
 *
 * Regra do usuário (2026-10-02): cada data vem da data CONCLUÍDA
 * (`completed_on`) da etapa do checklist —
 *
 *   Loading date  → loading_date      (todas em Unix segundos, às 12:00Z —
 *                                      mesmo dia no Brasil e na China; ver toGssUnix)
 *   Shipping date → shipping_date
 *   ETA Brazil    → eta_destination
 *   ATA Brazil    → ata_destination
 *   Delivered     → delivered_date
 *
 * `estimated_loading_date` (estimada do Loading date) e `ETD` (etapa ETD da
 * Order) estão na lista do usuário mas não têm campo no GSS ainda.
 *
 * Envio: PATCH com as datas; se o PL não existe lá (404), cria (POST) — Create
 * PL e PL antigo caem no mesmo caminho. Status só vai na criação.
 *
 * Sem `server-only` e com imports relativos: também roda no CLI
 * (scripts/sync-gss/push-outbound.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../../types/database";
import { gssRequest, type GssWriteResult } from "../client";

type DB = SupabaseClient<Database>;
type DateStr = string;

/** As etapas cuja data concluída vai ao GSS (os triggers da migration
 *  20261002120000 enfileiram exatamente estas). */
export const PL_SHIPMENT_STEPS = [
  "loading_date",
  "shipping_date",
  "eta_brazil",
  "ata_brazil",
  "delivered",
] as const;
type TrackedStep = (typeof PL_SHIPMENT_STEPS)[number];

/** Extrai o número de "PL - 1354" → 1354. null se o formato não bater. */
export function numericPlNumber(plNumber: string): number | null {
  const match = plNumber.match(/(\d+)\s*$/);
  return match ? Number(match[1]) : null;
}

export type PlShipmentState = {
  preLoadingId: string;
  plNumber: number;
  clientReference: string | null;
  podGssId: number | null;
  /** `shipments.status` ('in_transit' | 'delivered' | 'canceled'), ou null
   *  enquanto o embarque não foi confirmado. */
  shipmentStatus: string | null;
  completedOn: Record<TrackedStep, DateStr | null>;
};

export async function loadPlShipmentState(
  db: DB,
  preLoadingId: string
): Promise<{ state: PlShipmentState } | { skip: string }> {
  const { data: pl, error } = await db
    .from("pre_loadings")
    .select("id, pl_number, client_reference, deleted_at, pods(gss_id)")
    .eq("id", preLoadingId)
    .maybeSingle<{
      id: string;
      pl_number: string;
      client_reference: string | null;
      deleted_at: string | null;
      pods: { gss_id: string | null } | null;
    }>();
  if (error) throw new Error(`pre_loadings: ${error.message}`);
  if (!pl || pl.deleted_at) return { skip: "PL não existe mais no SOTWISE" };

  const plNumber = numericPlNumber(pl.pl_number);
  if (plNumber === null) return { skip: `pl_number não numérico: "${pl.pl_number}"` };

  const { data: shipment, error: shipmentError } = await db
    .from("shipments")
    .select("status")
    .eq("pre_loading_id", preLoadingId)
    .is("deleted_at", null)
    .maybeSingle<{ status: string }>();
  if (shipmentError) throw new Error(`shipments: ${shipmentError.message}`);

  const { data: steps, error: stepsError } = await db
    .from("pre_loading_checklist_steps")
    .select("step, completed_on")
    .eq("pre_loading_id", preLoadingId)
    .in("step", [...PL_SHIPMENT_STEPS])
    .returns<{ step: TrackedStep; completed_on: DateStr | null }[]>();
  if (stepsError) throw new Error(`pre_loading_checklist_steps: ${stepsError.message}`);

  const completedOn = Object.fromEntries(PL_SHIPMENT_STEPS.map((s) => [s, null])) as Record<
    TrackedStep,
    DateStr | null
  >;
  for (const row of steps ?? []) completedOn[row.step] = row.completed_on;

  const podGssId = pl.pods?.gss_id ? Number(pl.pods.gss_id) : null;

  return {
    state: {
      preLoadingId,
      plNumber,
      clientReference: pl.client_reference,
      podGssId: Number.isFinite(podGssId) ? podGssId : null,
      shipmentStatus: shipment?.status ?? null,
      completedOn,
    },
  };
}

/**
 * Data do checklist ("YYYY-MM-DD") → Unix em segundos, às 12:00 UTC. O GSS
 * passou a usar Unix (ISO ficou só como legado de entrada) e a decisão de
 * 05/10 é mandar só Unix. Meio-dia UTC cai no mesmo dia no Brasil (UTC-3) e na
 * China (UTC+8); meia-noite UTC — o que um "YYYY-MM-DD" puro vira lá — aparece
 * como o dia ANTERIOR no Brasil.
 */
export function toGssUnix(date: DateStr | null): number | null {
  if (!date) return null;
  const ms = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(ms) ? ms / 1000 : null;
}

/** As 5 datas no formato do GSS (Unix s). Etapa sem data concluída vai `null`,
 *  que no GSS limpa o campo — reabrir a etapa aqui reabre lá. */
export function datesBody(state: PlShipmentState): Record<string, number | null> {
  return {
    loading_date: toGssUnix(state.completedOn.loading_date),
    shipping_date: toGssUnix(state.completedOn.shipping_date),
    eta_destination: toGssUnix(state.completedOn.eta_brazil),
    ata_destination: toGssUnix(state.completedOn.ata_brazil),
    delivered_date: toGssUnix(state.completedOn.delivered),
  };
}

/**
 * Status de criação no GSS a partir do nosso. Só vale no POST: depois disso
 * mandamos apenas as datas (o GSS avisa que troca de status pode disparar
 * regras financeiras dele). Embarque cancelado não cria nada.
 */
export function createStatus(shipmentStatus: string | null): string | null {
  if (shipmentStatus === null) return "preloading";
  if (shipmentStatus === "in_transit" || shipmentStatus === "delivered") return shipmentStatus;
  return null;
}

export function createBody(state: PlShipmentState, status: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    pl_number: state.plNumber,
    status,
    ...datesBody(state),
  };
  const ref = state.clientReference?.trim();
  if (ref) body.customer_reference = ref.slice(0, 100);
  if (state.podGssId !== null) body.pod = state.podGssId;
  return body;
}

export type GssCall = { method: "PATCH" | "POST"; path: string; body: Record<string, unknown> };

export type PlShipmentPush =
  | { outcome: "skipped"; reason: string }
  /** Modo dry: o que seria enviado, sem chamar o GSS. */
  | { outcome: "planned"; patch: GssCall; createIfMissing: GssCall | null }
  /** A última chamada feita e o que o GSS respondeu. */
  | { outcome: "called"; call: GssCall; result: GssWriteResult; created: boolean };

function isPlNumberConflict(result: GssWriteResult): boolean {
  return result.status === 409 && (result.data as { code?: string } | null)?.code === "pl_number_conflict";
}

/**
 * `create: false` = só PATCH: PL que não existe no GSS sai `skipped` em vez de
 * ser criado. É o modo do envio na hora (decisão do usuário, 02/10: "testar
 * apenas o PATCH por enquanto"); a fila e o CLI seguem com o padrão (cria).
 */
export async function pushPlShipment(
  db: DB,
  preLoadingId: string,
  opts: { dry?: boolean; create?: boolean } = {}
): Promise<PlShipmentPush> {
  const loaded = await loadPlShipmentState(db, preLoadingId);
  if ("skip" in loaded) return { outcome: "skipped", reason: loaded.skip };
  const { state } = loaded;

  const path = `/shipments/${state.plNumber}/`;
  const patch: GssCall = { method: "PATCH", path, body: datesBody(state) };
  const status = createStatus(state.shipmentStatus);
  const create: GssCall | null = status
    ? { method: "POST", path: "/shipments/", body: createBody(state, status) }
    : null;

  if (opts.dry) return { outcome: "planned", patch, createIfMissing: create };

  const patched = await gssRequest(patch.method, patch.path, patch.body);
  if (!(patched.kind === "permanent" && patched.status === 404)) {
    await rememberGssId(db, preLoadingId, patched);
    return { outcome: "called", call: patch, result: patched, created: false };
  }

  if (opts.create === false) {
    return { outcome: "skipped", reason: `PL ${state.plNumber} não existe no GSS (criação desligada, só PATCH)` };
  }

  // Não existe no GSS → cria ("validar antes e criar").
  if (!create) {
    return { outcome: "skipped", reason: `embarque ${state.shipmentStatus}: não cria no GSS` };
  }
  const created = await gssRequest(create.method, create.path, create.body);

  // Corrida: outro disparo criou entre o 404 e o POST → vale o PATCH.
  if (isPlNumberConflict(created)) {
    const again = await gssRequest(patch.method, patch.path, patch.body);
    await rememberGssId(db, preLoadingId, again);
    return { outcome: "called", call: patch, result: again, created: false };
  }
  await rememberGssId(db, preLoadingId, created);
  return { outcome: "called", call: create, result: created, created: created.kind === "ok" };
}

/**
 * Guarda o id do Shipment do GSS (o `id` da resposta do PATCH/POST) em
 * `pre_loadings.gss_id`; o trigger da migration 20261005120000 leva para
 * `shipments.gss_id`. Só grava se mudou. Falha aqui não derruba o envio — o
 * dado no GSS já foi gravado; o vínculo se refaz no próximo envio.
 */
async function rememberGssId(db: DB, preLoadingId: string, result: GssWriteResult): Promise<void> {
  if (result.kind !== "ok") return;
  const id = (result.data as { id?: unknown } | null)?.id;
  if (typeof id !== "number" && typeof id !== "string") return;
  const gssId = String(id);
  const { error } = await db
    .from("pre_loadings")
    .update({ gss_id: gssId })
    .eq("id", preLoadingId)
    .or(`gss_id.is.null,gss_id.neq.${gssId}`);
  if (error) console.warn(`[gss] gss_id do PL ${preLoadingId} não gravado: ${error.message}`);
}
