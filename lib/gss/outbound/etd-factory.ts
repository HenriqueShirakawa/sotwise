/**
 * ETD de uma linha Factory × Category do SOTWISE → `/v1/shipments/etd-factories/`
 * do GSS (docs/INTEGRACAO_GSS.md §10.5, regras_de_negocio §6.12).
 *
 * O GSS guarda um registro por lote + fornecedor + categoria:
 *
 *   lote       → order_batch   (`batches.gss_id` — lote que não veio do GSS não vai)
 *   Factory    → supplier      (`factories.gss_id`; sem gss_id vai o nome literal)
 *   Category   → category      (`categories.gss_id`; idem)
 *   Initial    → initial_date  (Unix s, 12:00Z — mesma regra das datas do PL)
 *   Current    → current_date
 *   Ready?     → ready_parts
 *
 * Insp., Dispatch loc. e Dispatch date não têm campo no GSS e não vão.
 *
 * O GSS não faz upsert (duplicata = 409) e não tem DELETE: a cada envio
 * listamos os registros do lote, achamos o da linha por fornecedor + categoria
 * e fazemos PATCH; sem registro, POST — que o GSS só aceita com Initial E
 * Current preenchidas (null é proibido). Data vazia aqui não limpa lá.
 *
 * Sem `server-only` e com imports relativos: também roda no CLI
 * (scripts/sync-gss/push-etd-factories.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../../types/database";
import { dayToUnix } from "../../api-dates";
import { gssRequest, type GssWriteResult } from "../client";

type DB = SupabaseClient<Database>;

/** Referência de cadastro: id do GSS quando há, senão só o nome. */
type LocalRef = { id: number | null; name: string };

export type EtdFactoryState = {
  ofcId: string;
  /** "1705.02" — só para log. */
  label: string;
  batchGssId: number;
  supplier: LocalRef;
  category: LocalRef;
  initialDate: number | null;
  currentDate: number | null;
  ready: boolean;
};

type Embedded<T> = T | T[] | null;
const one = <T>(v: Embedded<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

function toRef(row: { gss_id: string | null; name: string } | null): LocalRef | null {
  if (!row) return null;
  const id = Number(row.gss_id);
  return { id: row.gss_id && Number.isInteger(id) && id > 0 ? id : null, name: row.name };
}

export async function loadEtdFactoryState(
  db: DB,
  ofcId: string
): Promise<{ state: EtdFactoryState } | { skip: string }> {
  const { data: row, error } = await db
    .from("order_factory_category")
    .select(
      "id, batches(gss_id, batch_number, orders(po_number)), factories(gss_id, name), " +
        "categories(gss_id, name), etd_info(initial_date, current_date, ready)"
    )
    .eq("id", ofcId)
    .maybeSingle<{
      id: string;
      batches: Embedded<{
        gss_id: string | null;
        batch_number: string;
        orders: Embedded<{ po_number: string }>;
      }>;
      factories: Embedded<{ gss_id: string | null; name: string }>;
      categories: Embedded<{ gss_id: string | null; name: string }>;
      etd_info: Embedded<{ initial_date: string | null; current_date: string | null; ready: boolean }>;
    }>();
  if (error) throw new Error(`order_factory_category: ${error.message}`);
  if (!row) return { skip: "linha Factory × Category não existe mais" };

  const batch = one(row.batches);
  if (!batch) return { skip: "linha sem lote" };
  const label = `${one(batch.orders)?.po_number ?? "?"} ${batch.batch_number}`;
  const batchGssId = Number(batch.gss_id);
  if (!batch.gss_id || !Number.isInteger(batchGssId) || batchGssId <= 0) {
    return { skip: `lote ${label} sem gss_id (não existe no GSS)` };
  }

  const supplier = toRef(one(row.factories));
  const category = toRef(one(row.categories));
  if (!supplier || !category) return { skip: `${label}: fábrica ou categoria ausente` };

  const etd = one(row.etd_info);
  return {
    state: {
      ofcId,
      label,
      batchGssId,
      supplier,
      category,
      initialDate: dayToUnix(etd?.initial_date),
      currentDate: dayToUnix(etd?.current_date),
      ready: etd?.ready ?? false,
    },
  };
}

/** O que o GSS devolve em supplier/category: id (número) ou texto literal. */
function sameRef(remote: unknown, local: LocalRef): boolean {
  if (typeof remote === "number") return local.id !== null && remote === local.id;
  if (typeof remote === "string") return remote.trim().toLowerCase() === local.name.trim().toLowerCase();
  return false;
}

const refValue = (ref: LocalRef): number | string => ref.id ?? ref.name.trim().slice(0, 200);

type RemoteEtd = {
  id: number;
  supplier: unknown;
  category: unknown;
  initial_date: number | null;
  current_date: number | null;
  ready_parts: boolean;
};

export type GssEtdCall = { method: "GET" | "PATCH" | "POST"; path: string; body?: Record<string, unknown> };

export type EtdFactoryPush =
  | { outcome: "skipped"; reason: string }
  /** Já igual no GSS — nada enviado. */
  | { outcome: "unchanged"; label: string; remoteId: number }
  /** Modo dry: o que seria enviado. */
  | { outcome: "planned"; label: string; call: GssEtdCall }
  /** A escrita feita (ou a leitura, se foi ela que falhou) e a resposta. */
  | { outcome: "called"; label: string; call: GssEtdCall; result: GssWriteResult };

async function findRemote(
  state: EtdFactoryState
): Promise<{ ok: true; remote: RemoteEtd | null } | { ok: false; call: GssEtdCall; result: GssWriteResult }> {
  const call: GssEtdCall = {
    method: "GET",
    path: `/shipments/etd-factories/?order_batch=${state.batchGssId}&page_size=200`,
  };
  const result = await gssRequest(call.method, call.path);
  if (result.kind !== "ok") return { ok: false, call, result };
  const rows = ((result.data as { results?: RemoteEtd[] } | null)?.results ?? []) as RemoteEtd[];
  const remote =
    rows.find((r) => sameRef(r.supplier, state.supplier) && sameRef(r.category, state.category)) ?? null;
  return { ok: true, remote };
}

/** Só os campos que mudaram; Initial/Current vazios aqui não vão (o GSS proíbe null). */
function patchBody(state: EtdFactoryState, remote: RemoteEtd): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (state.initialDate !== null && state.initialDate !== remote.initial_date) body.initial_date = state.initialDate;
  if (state.currentDate !== null && state.currentDate !== remote.current_date) body.current_date = state.currentDate;
  if (state.ready !== remote.ready_parts) body.ready_parts = state.ready;
  return body;
}

export async function pushEtdFactory(
  db: DB,
  ofcId: string,
  opts: { dry?: boolean } = {}
): Promise<EtdFactoryPush> {
  const loaded = await loadEtdFactoryState(db, ofcId);
  if ("skip" in loaded) return { outcome: "skipped", reason: loaded.skip };
  const { state } = loaded;

  const found = await findRemote(state);
  if (!found.ok) return { outcome: "called", label: state.label, call: found.call, result: found.result };

  if (found.remote) {
    const body = patchBody(state, found.remote);
    if (!Object.keys(body).length) {
      return { outcome: "unchanged", label: state.label, remoteId: found.remote.id };
    }
    const call: GssEtdCall = { method: "PATCH", path: `/shipments/etd-factories/${found.remote.id}/`, body };
    if (opts.dry) return { outcome: "planned", label: state.label, call };
    return { outcome: "called", label: state.label, call, result: await gssRequest(call.method, call.path, body) };
  }

  if (state.initialDate === null || state.currentDate === null) {
    return {
      outcome: "skipped",
      reason: `${state.label}: sem Initial/Current Date — o GSS exige as duas para criar`,
    };
  }

  const call: GssEtdCall = {
    method: "POST",
    path: "/shipments/etd-factories/",
    body: {
      order_batch: state.batchGssId,
      supplier: refValue(state.supplier),
      category: refValue(state.category),
      initial_date: state.initialDate,
      current_date: state.currentDate,
      ready_parts: state.ready,
    },
  };
  if (opts.dry) return { outcome: "planned", label: state.label, call };

  const created = await gssRequest(call.method, call.path, call.body);
  if (created.status !== 409) return { outcome: "called", label: state.label, call, result: created };

  // Corrida: outro disparo criou entre a leitura e o POST → atualiza o que existe.
  const again = await findRemote(state);
  if (!again.ok || !again.remote) return { outcome: "called", label: state.label, call, result: created };
  const body = patchBody(state, again.remote);
  if (!Object.keys(body).length) return { outcome: "unchanged", label: state.label, remoteId: again.remote.id };
  const patch: GssEtdCall = { method: "PATCH", path: `/shipments/etd-factories/${again.remote.id}/`, body };
  return { outcome: "called", label: state.label, call: patch, result: await gssRequest(patch.method, patch.path, body) };
}
