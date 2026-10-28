import "server-only";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { createBatch } from "@/domain/batches/api-write";
import { fetchAll } from "@/lib/fetch-all";
import { gssGet } from "@/lib/gss/client";
import { broadcastOrderStatusPing } from "@/lib/orders-realtime";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

/**
 * Pull de ORDERS e LOTES do GSS (2026-10-27) — roda no cron diário, depois do
 * sync das bibliotecas (app/api/cron/sync-gss).
 *
 * O GSS é o dono dos dois (o SOT não cria order nem lote). O push deles
 * (POST /api/orders, POST /api/batches) continua sendo a via principal; este
 * pull é a rede de segurança: o que não chegou ou ficou diferente é corrigido
 * aqui, e cada correção vira uma linha em `gss_sync_log` (abas Orders e Lotes do GSS parity, /access/gss?v=orders).
 *
 * Política (decisão do usuário, 27/10):
 *  - pareamento: `orders.gss_id` e, sem ele, `po_number` = id do GSS (a mesma
 *    regra do push); par achado pelo po_number ganha o gss_id;
 *  - cria a order/o lote que falta e atualiza o cabeçalho da order (cliente,
 *    exporter, business unit, order type, referência);
 *  - nunca apaga e nunca mexe em status (o status sai do SOT para o GSS);
 *  - campo vazio no GSS não limpa o nosso; nome que não existe aqui não é
 *    gravado (vira `warning` no log).
 *
 * Lote vai pelo MESMO `createBatch` do POST /api/batches: liga, adota (mesmo
 * número sem gss_id) ou cria vazio, com as travas e a regra do Gustavo de lá.
 *
 * TRAVADO por padrão (27/10): o GSS ainda é ambiente de teste e está sendo
 * alimentado do zero. Só grava com `GSS_ORDERS_PULL_ENABLED=true` na Vercel
 * (destrava sem deploy); travado, o cron só lê e devolve o plano.
 */
export function ordersPullEnabled(): boolean {
  return process.env.GSS_ORDERS_PULL_ENABLED === "true";
}

type Admin = ReturnType<typeof createAdminClient>;
type LogInsert = Database["public"]["Tables"]["gss_sync_log"]["Insert"];
type Change = { field: string; before: string | null; after: string | null };

type GssOrder = {
  id: number;
  customer_name: string | null;
  exporter_name: string | null;
  business_unit_name: string | null;
  order_type_name: string | null;
  client_reference: string | null;
  created_at: string;
};
type GssBatch = { batch_id: number; batch_code: string; order_id: number };

type LocalOrder = {
  id: string;
  po_number: string;
  gss_id: string | null;
  client_id: string | null;
  exporter_id: string | null;
  business_unit_id: string | null;
  order_type_id: string | null;
  client_reference: string | null;
};
type LocalBatch = { id: string; order_id: string; batch_number: string; gss_id: string | null };

/** Campos de cabeçalho que o pull acompanha: nome do GSS → biblioteca nossa. */
const LIB_FIELDS = [
  { gss: "customer_name", column: "client_id", table: "clients", label: "Client" },
  { gss: "exporter_name", column: "exporter_id", table: "exporters", label: "Exporter" },
  { gss: "business_unit_name", column: "business_unit_id", table: "business_units", label: "Business unit" },
  { gss: "order_type_name", column: "order_type_id", table: "order_types", label: "Order type" },
] as const;

type LibTable = (typeof LIB_FIELDS)[number]["table"];

export type OrdersSyncResult = {
  runId: string;
  orders: { gss: number; created: number; updated: number; linked: number; warnings: number; errors: number };
  batches: { gss: number; created: number; updated: number; linked: number; errors: number };
  /** Só no dry-run: o que seria gravado. */
  planned?: LogInsert[];
  logError?: string;
};

/** Caixa, acento e espaço não contam (o GSS grava sem acento e alterna caixa). */
const norm = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Lista do GSS: hoje vem array cru; se um dia paginar ({results,next}), segue as páginas. */
async function fetchList<T>(path: string): Promise<T[]> {
  const first = await gssGet<T[] | { results: T[]; next: string | null }>(path);
  if (!first.ok) throw new Error(`GSS ${path}: ${first.error}`);
  if (Array.isArray(first.data)) return first.data;
  const all = [...first.data.results];
  for (let page = 2, next = first.data.next; next; page++) {
    const r = await gssGet<{ results: T[]; next: string | null }>(`${path}?page=${page}`);
    if (!r.ok) throw new Error(`GSS ${path} página ${page}: ${r.error}`);
    all.push(...r.data.results);
    next = r.data.next;
  }
  return all;
}

/** Nome → id da biblioteca. Nome repetido: vale o que tem gss_id, se for um só. */
async function libIndex(admin: Admin, table: LibTable) {
  const rows = await fetchAll<{ id: string; name: string; gss_id: string | null }>((from, to) =>
    admin.from(table).select("id, name, gss_id").is("deleted_at", null).order("id").range(from, to)
  );
  const byName = new Map<string, { id: string; name: string; gss_id: string | null }[]>();
  for (const r of rows) {
    const k = norm(r.name);
    byName.set(k, [...(byName.get(k) ?? []), r]);
  }
  const names = new Map(rows.map((r) => [r.id, r.name]));
  const resolve = (name: string): { id: string } | { error: string } => {
    const hits = byName.get(norm(name)) ?? [];
    if (hits.length === 1) return { id: hits[0].id };
    if (hits.length === 0) return { error: `'${name}' não existe aqui` };
    const linked = hits.filter((h) => h.gss_id);
    if (linked.length === 1) return { id: linked[0].id };
    return { error: `'${name}' tem ${hits.length} cadastros iguais aqui` };
  };
  return { resolve, nameOf: (id: string | null) => (id ? (names.get(id) ?? id) : null) };
}

export async function runOrdersSync(admin: Admin, opts: { commit: boolean }): Promise<OrdersSyncResult> {
  const runId = randomUUID();
  // Uma leitura por vez: as duas listas são pesadas (~13–17 s cada) e, pedidas
  // juntas, o GSS devolve 5xx até esgotar as tentativas (28/10/2026).
  const gssOrders = await fetchList<GssOrder>("/orders/");
  const gssBatches = await fetchList<GssBatch>("/orders/batch-totals/");

  const libs = Object.fromEntries(
    await Promise.all(LIB_FIELDS.map(async (f) => [f.table, await libIndex(admin, f.table)] as const))
  ) as Record<LibTable, Awaited<ReturnType<typeof libIndex>>>;

  const locals = await fetchAll<LocalOrder>((from, to) =>
    admin
      .from("orders")
      .select("id, po_number, gss_id, client_id, exporter_id, business_unit_id, order_type_id, client_reference")
      .is("deleted_at", null)
      .order("id")
      .range(from, to)
  );
  const byGss = new Map(locals.filter((o) => o.gss_id).map((o) => [o.gss_id!, o]));
  const byPo = new Map(locals.map((o) => [o.po_number, o]));

  const log: LogInsert[] = [];
  const touched = new Set<string>();
  const result: OrdersSyncResult = {
    runId,
    orders: { gss: gssOrders.length, created: 0, updated: 0, linked: 0, warnings: 0, errors: 0 },
    batches: { gss: gssBatches.length, created: 0, updated: 0, linked: 0, errors: 0 },
  };

  // ---- ORDERS ---------------------------------------------------------------
  for (const g of gssOrders) {
    const gssId = String(g.id);
    const entry = { run_id: runId, entity: "order" as const, gss_id: gssId, ref: gssId };
    try {
      let local = byGss.get(gssId) ?? byPo.get(gssId) ?? null;
      if (local && local.gss_id && local.gss_id !== gssId) {
        // po_number bate, mas a order já é de OUTRO id do GSS — não é a mesma.
        log.push({
          ...entry,
          action: "error",
          order_id: local.id,
          record_id: local.id,
          message: `A order ${local.po_number} daqui já está ligada ao id ${local.gss_id} do GSS.`,
        });
        result.orders.errors++;
        continue;
      }

      // O que o GSS diz, já traduzido para os nossos ids.
      const fields: Record<string, string> = {};
      const changes: Change[] = [];
      const warnings: string[] = [];
      for (const f of LIB_FIELDS) {
        const name = g[f.gss];
        if (!name) continue; // vazio no GSS não limpa o nosso
        const hit = libs[f.table].resolve(name);
        if ("error" in hit) {
          warnings.push(`${f.label}: ${hit.error}`);
          continue;
        }
        const before = local ? local[f.column] : null;
        if (hit.id !== before) {
          fields[f.column] = hit.id;
          changes.push({ field: f.label, before: libs[f.table].nameOf(before), after: libs[f.table].nameOf(hit.id) });
        }
      }
      const reference = g.client_reference?.trim() || null;
      if (reference && reference !== (local?.client_reference ?? null)) {
        fields.client_reference = reference;
        changes.push({ field: "Client reference", before: local?.client_reference ?? null, after: reference });
      }

      if (!local) {
        if (opts.commit) {
          const { data, error } = await admin
            .from("orders")
            .insert({ ...fields, gss_id: gssId, po_number: gssId, date_po: g.created_at.slice(0, 10) } as never)
            .select("id, po_number, gss_id, client_id, exporter_id, business_unit_id, order_type_id, client_reference")
            .single();
          if (error || !data) throw new Error(error?.message ?? "insert sem retorno");
          local = data as LocalOrder;
          byGss.set(gssId, local);
          byPo.set(local.po_number, local);
          touched.add(local.id);
        }
        log.push({
          ...entry,
          action: warnings.length ? "warning" : "created",
          order_id: local?.id ?? null,
          record_id: local?.id ?? null,
          changes,
          message: warnings.length ? warnings.join(" · ") : null,
        });
        result.orders.created++;
        if (warnings.length) result.orders.warnings++;
        continue;
      }

      const linking = !local.gss_id;
      if (linking) changes.unshift({ field: "gss_id", before: null, after: gssId });
      if (changes.length === 0 && warnings.length === 0) continue; // igual nos dois lados

      if (opts.commit && changes.length > 0) {
        const { error } = await admin
          .from("orders")
          .update({ ...fields, ...(linking ? { gss_id: gssId } : {}) } as never)
          .eq("id", local.id);
        if (error) throw new Error(error.message);
        Object.assign(local, fields, linking ? { gss_id: gssId } : {});
        byGss.set(gssId, local);
        touched.add(local.id);
      }
      const onlyLink = linking && changes.length === 1;
      log.push({
        ...entry,
        ref: local.po_number,
        action: warnings.length ? "warning" : onlyLink ? "linked" : "updated",
        order_id: local.id,
        record_id: local.id,
        changes: changes.length ? changes : null,
        message: warnings.length ? warnings.join(" · ") : null,
      });
      if (onlyLink) result.orders.linked++;
      else if (changes.length) result.orders.updated++;
      if (warnings.length) result.orders.warnings++;
    } catch (e) {
      log.push({ ...entry, action: "error", message: e instanceof Error ? e.message : String(e) });
      result.orders.errors++;
    }
  }

  // ---- LOTES ----------------------------------------------------------------
  const batches = await fetchAll<LocalBatch>((from, to) =>
    admin.from("batches").select("id, order_id, batch_number, gss_id").order("id").range(from, to)
  );
  const batchByGss = new Map(batches.filter((b) => b.gss_id).map((b) => [b.gss_id!, b]));
  const poById = new Map([...byPo.values()].map((o) => [o.id, o.po_number]));

  for (const b of gssBatches) {
    const gssId = String(b.batch_id);
    const order = byGss.get(String(b.order_id)) ?? null;
    const entry = { run_id: runId, entity: "batch" as const, gss_id: gssId, ref: b.batch_code };
    if (!order) {
      // Em dry-run a order nova ainda não existe; o lote dela seria criado junto.
      if (!opts.commit && gssOrders.some((g) => g.id === b.order_id)) {
        log.push({ ...entry, action: "created", changes: [{ field: "Batch", before: null, after: b.batch_code }] });
        result.batches.created++;
        continue;
      }
      log.push({ ...entry, action: "error", message: `A order ${b.order_id} do GSS não existe aqui.` });
      result.batches.errors++;
      continue;
    }

    const number = b.batch_code.startsWith(`${order.po_number}.`)
      ? b.batch_code.slice(order.po_number.length)
      : b.batch_code;
    const known = batchByGss.get(gssId);
    if (known && known.order_id === order.id && known.batch_number === number) continue;

    // Classifica antes de gravar (createBatch decide igual): renomeia, adota ou cria.
    const adopt = known ? null : batches.find((x) => x.order_id === order.id && x.batch_number === number && !x.gss_id);
    const action = known ? "updated" : adopt ? "linked" : "created";
    const fullOf = (x: LocalBatch) => `${poById.get(x.order_id) ?? "?"}${x.batch_number}`;
    const changes: Change[] = known
      ? known.order_id !== order.id
        ? [{ field: "Order", before: poById.get(known.order_id) ?? null, after: order.po_number }]
        : [{ field: "Batch", before: fullOf(known), after: b.batch_code }]
      : adopt
        ? [{ field: "gss_id", before: null, after: gssId }]
        : [{ field: "Batch", before: null, after: b.batch_code }];

    let recordId = known?.id ?? adopt?.id ?? null;
    if (opts.commit) {
      const res = await createBatch(admin, {
        gss_id: gssId,
        order_gss_id: String(b.order_id),
        batch_number: b.batch_code,
      });
      if (!res.ok) {
        log.push({ ...entry, action: "error", order_id: order.id, record_id: recordId, changes, message: res.error });
        result.batches.errors++;
        continue;
      }
      recordId = res.data.id;
      touched.add(order.id);
    }
    log.push({ ...entry, action, order_id: order.id, record_id: recordId, changes });
    result.batches[action]++;
  }

  if (!opts.commit) return { ...result, planned: log };

  if (touched.size > 0) {
    revalidatePath("/orders/[id]", "page");
    revalidatePath("/orders");
    await broadcastOrderStatusPing({ order_ids: [...touched] });
  }

  for (let i = 0; i < log.length; i += 500) {
    const { error } = await admin.from("gss_sync_log").insert(log.slice(i, i + 500));
    if (error) {
      console.warn(`gss_sync_log: ${error.message}`);
      result.logError = error.message;
      break;
    }
  }
  return result;
}
