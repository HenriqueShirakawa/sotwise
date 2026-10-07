/**
 * Carga dos PLs do SOTWISE no `/v1/shipments/` do GSS + vínculo com os lotes.
 *
 *   npx tsx scripts/sync-gss/push-pl-shipments.ts                 # DRY: o que seria enviado
 *   npx tsx scripts/sync-gss/push-pl-shipments.ts --commit        # envia
 *   ... --only 1306,1273   só esses PLs        ... --out <pasta>   onde gravar o relatório CSV
 *
 * Por PL (em ordem crescente de número):
 *   - não existe no GSS → POST com status, 5 datas, customer_reference, POD,
 *     leader/signer por e-mail e `batch_ids`;
 *   - já existe → PATCH com datas, POD, e-mails e `batch_ids` (status não muda).
 * `batch_ids` = lotes do PL que JÁ existem no GSS (batch_code ↔ full_number).
 * Rodar de novo é seguro: completa os lotes que o GSS criar depois.
 *
 * Falhas por campo não derrubam o PL (decisão do usuário 07/10): e-mail sem
 * usuário no GSS vai null, lote já vinculado a outro shipment sai da lista —
 * e tudo isso fica no relatório para análise caso a caso.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

import { gssGet, gssRequest, type GssWriteResult } from "../../lib/gss/client";
import {
  PL_SHIPMENT_STEPS,
  createBody,
  createStatus,
  datesBody,
  numericPlNumber,
  type PlShipmentState,
} from "../../lib/gss/outbound/pl-shipment";

const argv = process.argv.slice(2);
const COMMIT = argv.includes("--commit");
const arg = (flag: string) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ONLY = new Set((arg("--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(Number));
const OUT_DIR = arg("--out") ?? tmpdir();

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function fetchAll<T>(table: string, select: string, order: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(select).order(order).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data as T[]));
    if (data.length < 1000) return out;
  }
}

async function emailsById(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth.users: ${error.message}`);
    for (const u of data.users) if (u.email) map.set(u.id, u.email.toLowerCase());
    if (data.users.length < 1000) return map;
  }
}

type GssShipment = { id: number; pl_number: number; batches: { id: number }[] };

async function gssShipments(): Promise<Map<number, GssShipment>> {
  const map = new Map<number, GssShipment>();
  for (let page = 1; ; page++) {
    const res = await gssGet<{ next: string | null; results: GssShipment[] }>(`/shipments/?page_size=200&page=${page}`);
    if (!res.ok) throw new Error(`GSS /shipments/: ${res.error}`);
    for (const s of res.data.results) map.set(s.pl_number, s);
    if (!res.data.next) return map;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = {
  pl: number;
  action: "POST" | "PATCH" | "skip";
  http: number | "";
  outcome: string;
  gss_id: string;
  batches_sent: string;
  batches_dropped: string;
  leader_email: string;
  signer_email: string;
  emails_dropped: string;
  error: string;
};

/** E-mails que o GSS já recusou nesta execução — não repete a tentativa. */
const badEmails = new Set<string>();

/**
 * Envia e corrige o que for recusável por campo: 400 de leader_email/signer_email
 * → manda null; 409 batch_already_linked → tira o lote. 429/5xx → espera e repete.
 */
async function send(
  method: "POST" | "PATCH",
  path: string,
  body: Record<string, unknown>,
  row: Row
): Promise<GssWriteResult> {
  const droppedBatches: number[] = [];
  const droppedEmails: string[] = [];
  let backoff = 2000;
  for (let attempt = 0; attempt < 12; attempt++) {
    const res = await gssRequest(method, path, body);
    if (res.kind === "retryable" || res.kind === "blocked") {
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 30_000);
      continue;
    }
    const data = res.data as Record<string, unknown> | null;
    if (res.status === 400 && data) {
      let fixed = false;
      for (const field of ["leader_email", "signer_email"] as const) {
        if (data[field] && body[field]) {
          badEmails.add(String(body[field]));
          droppedEmails.push(`${field}=${body[field]} (${JSON.stringify(data[field])})`);
          body[field] = null;
          fixed = true;
        }
      }
      if (fixed) continue;
    }
    if (res.status === 409 && data?.code === "batch_already_linked") {
      const id = Number(String(data.message ?? "").match(/Batch (\d+)/)?.[1]);
      const ids = (body.batch_ids as number[] | undefined) ?? [];
      if (Number.isFinite(id) && ids.includes(id)) {
        droppedBatches.push(id);
        body.batch_ids = ids.filter((b) => b !== id);
        continue;
      }
    }
    row.batches_dropped = droppedBatches.join(" ");
    row.emails_dropped = droppedEmails.join(" | ");
    return res;
  }
  row.batches_dropped = droppedBatches.join(" ");
  row.emails_dropped = droppedEmails.join(" | ");
  return { kind: "retryable", status: 0, data: null, text: "", error: "desisti após 12 tentativas" };
}

async function main() {
  console.log(COMMIT ? "== COMMIT: enviando ao GSS ==" : "== DRY: nada é enviado (--commit envia) ==");

  const [pls, ships, pods, steps, plb, batches, emails, gssBatches, existing] = await Promise.all([
    fetchAll<any>("pre_loadings", "id, pl_number, client_reference, pod_id, leader_id, responsible_signer_id, deleted_at, gss_id", "id"),
    fetchAll<any>("shipments", "pre_loading_id, status, leader_id, signer_id, deleted_at", "id"),
    fetchAll<any>("pods", "id, gss_id", "id"),
    fetchAll<any>("pre_loading_checklist_steps", "pre_loading_id, step, completed_on", "id"),
    fetchAll<any>("pre_loading_batches", "pre_loading_id, batch_id", "pre_loading_id,batch_id"),
    fetchAll<any>("batches", "id, batch_number, orders(po_number)", "id"),
    emailsById(),
    gssGet<{ batch_id: number; batch_code: string }[]>("/orders/batch-totals/"),
    gssShipments(),
  ]);
  if (!gssBatches.ok) throw new Error(`GSS batch-totals: ${gssBatches.error}`);

  const gssBatchByCode = new Map(gssBatches.data.map((b) => [b.batch_code, b.batch_id]));
  const shipByPl = new Map(ships.filter((s) => !s.deleted_at).map((s) => [s.pre_loading_id, s]));
  const podGss = new Map(pods.map((p) => [p.id, p.gss_id ? Number(p.gss_id) : null]));
  const fullNumber = new Map(batches.map((b) => [b.id, `${b.orders?.po_number}${b.batch_number}`]));
  const tracked = new Set<string>(PL_SHIPMENT_STEPS);
  const stepsByPl = new Map<string, Record<string, string | null>>();
  for (const s of steps) {
    if (!tracked.has(s.step)) continue;
    const m = stepsByPl.get(s.pre_loading_id) ?? {};
    m[s.step] = s.completed_on;
    stepsByPl.set(s.pre_loading_id, m);
  }
  const batchesByPl = new Map<string, string[]>();
  for (const l of plb) batchesByPl.set(l.pre_loading_id, [...(batchesByPl.get(l.pre_loading_id) ?? []), l.batch_id]);

  const todo = pls
    .filter((p) => !p.deleted_at)
    .map((p) => ({ ...p, num: numericPlNumber(p.pl_number) }))
    .filter((p) => p.num !== null && (ONLY.size === 0 || ONLY.has(p.num)))
    .sort((a, b) => a.num - b.num);

  const rows: Row[] = [];
  let i = 0;
  for (const p of todo) {
    i++;
    const ship = shipByPl.get(p.id);
    const completed = stepsByPl.get(p.id) ?? {};
    const podId = p.pod_id ? podGss.get(p.pod_id) ?? null : null;
    const state: PlShipmentState = {
      preLoadingId: p.id,
      plNumber: p.num,
      clientReference: p.client_reference,
      podGssId: Number.isFinite(podId) ? podId : null,
      shipmentStatus: ship?.status ?? null,
      completedOn: Object.fromEntries(PL_SHIPMENT_STEPS.map((s) => [s, completed[s] ?? null])) as PlShipmentState["completedOn"],
    };
    // Leader/signer: os do embarque; antes do Confirm, os do PL.
    const leader = emails.get(ship?.leader_id ?? p.leader_id) ?? null;
    const signer = emails.get(ship?.signer_id ?? p.responsible_signer_id) ?? null;
    const batchIds = [
      ...new Set((batchesByPl.get(p.id) ?? []).map((b) => gssBatchByCode.get(fullNumber.get(b)!)).filter((x): x is number => !!x)),
    ];

    const row: Row = {
      pl: p.num, action: "skip", http: "", outcome: "", gss_id: "", batches_sent: "", batches_dropped: "",
      leader_email: leader ?? "", signer_email: signer ?? "", emails_dropped: "", error: "",
    };
    rows.push(row);

    const people: Record<string, unknown> = {
      leader_email: leader && !badEmails.has(leader) ? leader : null,
      signer_email: signer && !badEmails.has(signer) ? signer : null,
    };
    const there = existing.get(p.num);
    let method: "POST" | "PATCH";
    let path: string;
    let body: Record<string, unknown>;
    if (there) {
      method = "PATCH";
      path = `/shipments/${p.num}/`;
      body = { ...datesBody(state), ...people, batch_ids: batchIds };
      if (state.podGssId !== null) body.pod = state.podGssId;
    } else {
      const status = createStatus(state.shipmentStatus);
      if (!status) {
        row.outcome = `não cria: embarque ${state.shipmentStatus}`;
        continue;
      }
      method = "POST";
      path = "/shipments/";
      body = { ...createBody(state, status), ...people, batch_ids: batchIds };
    }
    row.action = method;
    row.batches_sent = batchIds.join(" ");

    if (!COMMIT) {
      row.outcome = "planejado";
      if (ONLY.size || batchIds.length || i <= 3) console.log(`PL ${p.num}: ${method} ${path} ${JSON.stringify(body)}`);
      continue;
    }

    const res = await send(method, path, body, row);
    row.http = res.status;
    row.outcome = res.kind;
    if (res.kind !== "ok") {
      row.error = (res.error ?? res.text).slice(0, 500);
    } else {
      const id = (res.data as { id?: unknown } | null)?.id;
      row.gss_id = id == null ? "" : String(id);
      row.batches_sent = ((body.batch_ids as number[]) ?? []).join(" ");
      if (row.gss_id && row.gss_id !== p.gss_id) {
        const { error } = await db.from("pre_loadings").update({ gss_id: row.gss_id }).eq("id", p.id);
        if (error) row.error = `gss_id não gravado: ${error.message}`;
      }
    }
    if (i % 50 === 0) console.log(`… ${i}/${todo.length}`);
  }

  // ---- relatório ----
  const count = (f: (r: Row) => boolean) => rows.filter(f).length;
  console.log(`\nPLs: ${rows.length} | POST ${count((r) => r.action === "POST")} | PATCH ${count((r) => r.action === "PATCH")} | pulados ${count((r) => r.action === "skip")}`);
  if (COMMIT) {
    console.log(`ok ${count((r) => r.outcome === "ok")} | falha ${count((r) => r.action !== "skip" && r.outcome !== "ok")}`);
    console.log(`e-mails recusados pelo GSS (foram null): ${[...badEmails].join(", ") || "nenhum"}`);
    console.log(`PLs com lote recusado (já vinculado): ${count((r) => !!r.batches_dropped)}`);
  }
  const withBatches = rows.filter((r) => r.batches_sent);
  console.log(`PLs com lotes: ${withBatches.map((r) => `${r.pl}[${r.batches_sent}]`).join(", ") || "nenhum"}`);
  const noEmail = { leader: count((r) => r.action !== "skip" && !r.leader_email), signer: count((r) => r.action !== "skip" && !r.signer_email) };
  console.log(`sem e-mail aqui: leader ${noEmail.leader} | signer ${noEmail.signer}`);
  const distinct = new Set(rows.flatMap((r) => [r.leader_email, r.signer_email]).filter(Boolean));
  console.log(`e-mails distintos: ${[...distinct].join(", ")}`);

  const cols = Object.keys(rows[0] ?? {}) as (keyof Row)[];
  const csv = [cols.join(";"), ...rows.map((r) => cols.map((c) => String(r[c]).replace(/[;\n]/g, " ")).join(";"))].join("\n");
  const file = join(OUT_DIR, `pl-gss-${COMMIT ? "commit" : "dry"}-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);
  writeFileSync(file, csv);
  console.log(`\nrelatório: ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
