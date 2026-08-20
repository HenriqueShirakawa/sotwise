import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import type { BatchStatus } from "@/types/database";
import type { BatchOption } from "@/app/(dashboard)/pre-loading/pre-loading-form-modal";

type Admin = ReturnType<typeof createAdminClient>;

/** Só lotes em produção/pre-loading podem entrar num Pre-loading (docs §3.7.4). */
const SELECTABLE_BATCH_STATUSES: BatchStatus[] = ["in_production", "preloading"];

type SelectableBatchRow = {
  id: string;
  order_id: string;
  batch_number: string;
  status: BatchStatus;
  orders: { po_number: string; client_id: string | null } | null;
};
type OfcBatchRow = {
  batch_id: string | null;
  factory_id: string;
  category_id: string;
};

/**
 * Lista de lotes selecionáveis no modal Create/Edit Pre-loading. É a MESMA
 * regra montada inline em `app/(dashboard)/pre-loading/page.tsx` (no render da
 * página), extraída aqui para o modal poder rebuscar ao abrir — assim um lote
 * criado/movido pra Production com a página já aberta aparece sem F5, sem
 * depender do refresh do route inteiro. Se mudar a regra num lugar, mude no
 * outro.
 */
export async function loadSelectableBatchOptions(admin: Admin): Promise<BatchOption[]> {
  const [batches, ofc, plBatches, livePls, clients, factories, categories] = await Promise.all([
    fetchAll<SelectableBatchRow>((from, to) =>
      admin
        .from("batches")
        .select("id, order_id, batch_number, status, orders!inner(po_number, client_id)")
        .in("status", SELECTABLE_BATCH_STATUSES)
        .is("orders.deleted_at", null)
        .range(from, to)
        .returns<SelectableBatchRow[]>()
    ),
    fetchAll<OfcBatchRow>((from, to) =>
      admin
        .from("order_factory_category")
        .select("batch_id, factory_id, category_id, batches!inner(status)")
        .in("batches.status", SELECTABLE_BATCH_STATUSES)
        .range(from, to)
        .returns<OfcBatchRow[]>()
    ),
    fetchAll<{ pre_loading_id: string; batch_id: string }>((from, to) =>
      admin.from("pre_loading_batches").select("pre_loading_id, batch_id").range(from, to)
    ),
    fetchAll<{ id: string }>((from, to) =>
      admin.from("pre_loadings").select("id").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("clients").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("factories").select("id, name").is("deleted_at", null).range(from, to)
    ),
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("categories").select("id, name").is("deleted_at", null).range(from, to)
    ),
  ]);

  const clientNameById = new Map(clients.map((c) => [c.id, c.name]));
  const factoryNameById = new Map(factories.map((f) => [f.id, f.name]));
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  // Lotes já reservados por um PL vivo (o de um PL soft-deleted volta a ficar livre).
  const livePlIds = new Set(livePls.map((p) => p.id));
  const plIdByBatchId = new Map<string, string>();
  for (const pb of plBatches) {
    if (!livePlIds.has(pb.pre_loading_id)) continue;
    plIdByBatchId.set(pb.batch_id, pb.pre_loading_id);
  }

  const entriesByBatchId = new Map<string, { factory: string; category: string }[]>();
  for (const o of ofc) {
    if (!o.batch_id) continue;
    const arr = entriesByBatchId.get(o.batch_id) ?? [];
    arr.push({
      factory: factoryNameById.get(o.factory_id) ?? "—",
      category: categoryNameById.get(o.category_id) ?? "—",
    });
    entriesByBatchId.set(o.batch_id, arr);
  }

  return batches.map((b) => ({
    id: b.id,
    order_id: b.order_id,
    po_number: b.orders?.po_number ?? "—",
    batch_number: b.batch_number,
    status: b.status,
    client: b.orders?.client_id ? (clientNameById.get(b.orders.client_id) ?? null) : null,
    client_id: b.orders?.client_id ?? null,
    pre_loading_id: plIdByBatchId.get(b.id) ?? null,
    entries: entriesByBatchId.get(b.id) ?? [],
  }));
}
