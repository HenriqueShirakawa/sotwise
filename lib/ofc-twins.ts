import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import type { LoadingStatus } from "@/types/database";

/**
 * "Gêmea" = outra entrada Factory × Category no MESMO lote com a mesma
 * Category + Factory. Lotes espelhados (.01 e .02 com as mesmas entradas) são
 * normais; o que não pode é o mesmo lote ter a mesma Category + Factory duas
 * vezes — foi o que o split do Confirm Shipping criava (QA 25/09, pedidos 1665
 * e 1668). Ver docs/regras_de_negocio.md §3.7.2 "Lotes espelhados".
 */

type AdminClient = ReturnType<typeof createAdminClient>;

type TwinCandidate = { category_id: string; factory_id: string };

const twinKey = (r: TwinCandidate) => `${r.category_id}|${r.factory_id}`;

/**
 * Valida que nenhuma das entradas novas repete Category + Factory já presente
 * no lote (nem entre si). `excludeId` ignora a própria entrada numa troca de
 * lote. Devolve a mensagem de erro, ou null quando está tudo certo.
 */
export async function findBatchTwinError(
  admin: AdminClient,
  batchId: string,
  rows: TwinCandidate[],
  excludeId?: string
): Promise<string | null> {
  if (rows.length === 0) return null;

  let query = admin
    .from("order_factory_category")
    .select("id, category_id, factory_id")
    .eq("batch_id", batchId);
  if (excludeId) query = query.neq("id", excludeId);
  const { data: existing, error } = await query;
  if (error) return error.message;

  const taken = new Set((existing ?? []).map(twinKey));
  const dup = rows.find((r) => {
    const key = twinKey(r);
    if (taken.has(key)) return true;
    taken.add(key);
    return false;
  });
  if (!dup) return null;
  return `${await twinLabel(admin, dup)} already exists in batch ${await batchLabel(admin, batchId)}.`;
}

async function twinLabel(admin: AdminClient, r: TwinCandidate): Promise<string> {
  const [{ data: factory }, { data: category }] = await Promise.all([
    admin.from("factories").select("name").eq("id", r.factory_id).maybeSingle(),
    admin.from("categories").select("name").eq("id", r.category_id).maybeSingle(),
  ]);
  return `${factory?.name ?? "This factory"} × ${category?.name ?? "category"}`;
}

async function batchLabel(admin: AdminClient, batchId: string): Promise<string> {
  const { data } = await admin
    .from("batches")
    .select("batch_number")
    .eq("id", batchId)
    .maybeSingle();
  return data?.batch_number ?? "";
}

/**
 * Depois do Confirm Shipping: a linha Partial/None que o split moveu para um
 * lote que JÁ tinha a mesma Category + Factory volta para o lote que embarcou,
 * com o status gravado no embarque. A gêmea do destino já é a continuação do
 * saldo — mover a de origem só duplicava a entrada.
 *
 * Vive aqui (e não só na função de banco `confirm_shipping`) para valer sem
 * depender de migration: a 20260925130000_confirm_shipping_twin_lines.sql faz o
 * mesmo dentro do banco e, aplicada, deixa esta passada sem nada para corrigir.
 *
 * Quando o destino não tinha gêmea mas recebeu a mesma entrada de DOIS lotes
 * deste embarque (ex.: .01 e .02 no mesmo PL, os dois Partial), fica a do lote
 * de número menor e a outra volta.
 */
export async function keepSplitTwinsInOrigin(
  admin: AdminClient,
  shipmentId: string
): Promise<string | null> {
  const { data: loaded, error: loadedErr } = await admin
    .from("shipment_loaded_lines")
    .select("batch_id, order_factory_category_id, loading_status")
    .eq("shipment_id", shipmentId)
    .neq("loading_status", "total");
  if (loadedErr) return loadedErr.message;
  if (!loaded || loaded.length === 0) return null;

  const snapshot = new Map(
    loaded.map((l) => [
      l.order_factory_category_id,
      { origin: l.batch_id, status: l.loading_status as LoadingStatus },
    ])
  );

  const { data: current, error: currentErr } = await admin
    .from("order_factory_category")
    .select("id, batch_id")
    .in("id", [...snapshot.keys()]);
  if (currentErr) return currentErr.message;

  const movedIds = new Set(
    (current ?? [])
      .filter((o) => o.batch_id && o.batch_id !== snapshot.get(o.id)?.origin)
      .map((o) => o.id)
  );
  if (movedIds.size === 0) return null;

  const targetIds = [
    ...new Set(
      (current ?? []).filter((o) => movedIds.has(o.id)).map((o) => o.batch_id as string)
    ),
  ];
  const originIds = [...new Set(loaded.map((l) => l.batch_id))];

  const [{ data: targetRows, error: targetErr }, { data: batchRows, error: batchErr }] =
    await Promise.all([
      admin
        .from("order_factory_category")
        .select("id, batch_id, category_id, factory_id")
        .in("batch_id", targetIds),
      admin
        .from("batches")
        .select("id, batch_number, split_from_batch_id")
        .in("id", [...targetIds, ...originIds]),
    ]);
  if (targetErr) return targetErr.message;
  if (batchErr) return batchErr.message;

  const batchNumber = new Map((batchRows ?? []).map((b) => [b.id, b.batch_number]));
  const originNumber = (ofcId: string) => batchNumber.get(snapshot.get(ofcId)!.origin) ?? "";

  // Por lote de destino × (Category + Factory): nativa do destino ganha; sem
  // nativa, fica a migrada do lote de origem de número menor.
  const groups = new Map<string, { natives: string[]; moved: string[] }>();
  for (const r of targetRows ?? []) {
    const key = `${r.batch_id}|${twinKey(r)}`;
    const g = groups.get(key) ?? { natives: [], moved: [] };
    (movedIds.has(r.id) ? g.moved : g.natives).push(r.id);
    groups.set(key, g);
  }
  const sendBack: string[] = [];
  for (const g of groups.values()) {
    if (g.moved.length === 0) continue;
    if (g.natives.length > 0) {
      sendBack.push(...g.moved);
    } else if (g.moved.length > 1) {
      const sorted = [...g.moved].sort((a, b) =>
        originNumber(a).localeCompare(originNumber(b), undefined, { numeric: true })
      );
      sendBack.push(...sorted.slice(1));
    }
  }
  if (sendBack.length === 0) return null;

  // Uma escrita por (lote de origem × status).
  const byOriginStatus = new Map<string, string[]>();
  for (const id of sendBack) {
    const s = snapshot.get(id)!;
    const key = `${s.origin}|${s.status}`;
    byOriginStatus.set(key, [...(byOriginStatus.get(key) ?? []), id]);
  }
  for (const [key, ids] of byOriginStatus) {
    const [origin, status] = key.split("|");
    const { error } = await admin
      .from("order_factory_category")
      .update({ batch_id: origin, loading_status: status as LoadingStatus })
      .in("id", ids);
    if (error) return error.message;
  }

  // Linhagem: o destino que ficou sem nenhuma linha vinda do lote embarcado não
  // é filho dele. (Os lotes deste PL acabaram de embarcar pela primeira vez, então
  // qualquer split_from apontando pra eles foi anotado agora.)
  const back = new Set(sendBack);
  for (const b of batchRows ?? []) {
    if (!targetIds.includes(b.id) || !b.split_from_batch_id) continue;
    if (!originIds.includes(b.split_from_batch_id)) continue;
    const stillFromParent = [...movedIds].some(
      (id) =>
        !back.has(id) &&
        snapshot.get(id)!.origin === b.split_from_batch_id &&
        (current ?? []).find((o) => o.id === id)?.batch_id === b.id
    );
    if (!stillFromParent) {
      const { error } = await admin
        .from("batches")
        .update({ split_from_batch_id: null })
        .eq("id", b.id);
      if (error) return error.message;
    }
  }
  return null;
}
