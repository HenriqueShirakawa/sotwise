import { verifySession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { readColumnVisibility } from "@/lib/column-prefs";
import { PageHeader } from "@/components/page-header";
import type { ChecklistStep, OrderStatus } from "@/types/database";

import { TodoClient, type TodoRow } from "./todo-client";
import type { Ref } from "./filters-modal";

/**
 * To do list (docs §3.12.2). VIEW read-only sobre as etapas de checklist
 * pendentes (`completed_on IS NULL`) do usuário logado, unindo Orders e
 * Pre-loading/Shipment. Montada no server component (padrão do repo, sem VIEW
 * no banco). O conjunto é sempre pequeno — só as tarefas do próprio usuário —,
 * então resolvemos os relacionamentos por id, sem paginação em bloco.
 */
export default async function TodoPage() {
  const { userId, profile } = await verifySession();
  const admin = createAdminClient();

  const inIds = async <T,>(
    ids: Set<string>,
    build: (list: string[]) => PromiseLike<{ data: T[] | null }>
  ): Promise<T[]> => {
    if (ids.size === 0) return [];
    const { data } = await build([...ids]);
    return data ?? [];
  };

  // Etapas pendentes do usuário. Order tem `enabled` (etapa N/A não é tarefa);
  // pre-loading não tem esse conceito.
  const [orderStepsRes, plStepsRes] = await Promise.all([
    admin
      .from("order_checklist_steps")
      .select("id, order_id, step, estimated_date")
      .eq("responsible_id", userId)
      .eq("enabled", true)
      .is("completed_on", null),
    admin
      .from("pre_loading_checklist_steps")
      .select("id, pre_loading_id, step, estimated_date")
      .eq("responsible_id", userId)
      .is("completed_on", null),
  ]);

  const orderSteps = (orderStepsRes.data ?? []) as {
    id: string;
    order_id: string;
    step: ChecklistStep;
    estimated_date: string | null;
  }[];
  const plSteps = (plStepsRes.data ?? []) as {
    id: string;
    pre_loading_id: string;
    step: ChecklistStep;
    estimated_date: string | null;
  }[];

  const plIds = new Set(plSteps.map((s) => s.pre_loading_id));

  // Relações do ramo PL (não dependem de orders/clients).
  const [preLoadings, plClients, plBatches, shipments] = await Promise.all([
    inIds<{ id: string; pl_number: string }>(plIds, (list) =>
      admin.from("pre_loadings").select("id, pl_number").in("id", list)
    ),
    inIds<{ pre_loading_id: string; client_id: string }>(plIds, (list) =>
      admin.from("pre_loading_clients").select("pre_loading_id, client_id").in("pre_loading_id", list)
    ),
    inIds<{ pre_loading_id: string; batch_id: string }>(plIds, (list) =>
      admin.from("pre_loading_batches").select("pre_loading_id, batch_id").in("pre_loading_id", list)
    ),
    inIds<{ id: string; pre_loading_id: string }>(plIds, (list) =>
      admin
        .from("shipments")
        .select("id, pre_loading_id")
        .is("deleted_at", null)
        .in("pre_loading_id", list)
    ),
  ]);

  // batches → order_id (para consolidar as POs de cada PL).
  const plBatchIds = new Set(plBatches.map((b) => b.batch_id));
  const batchOrderRows = await inIds<{ id: string; order_id: string }>(plBatchIds, (list) =>
    admin.from("batches").select("id, order_id").in("id", list)
  );
  const orderIdByBatch = new Map(batchOrderRows.map((b) => [b.id, b.order_id]));

  // Orders: ramo Order (order_id direto) + Orders vinculadas aos PLs.
  const orderIds = new Set<string>(orderSteps.map((s) => s.order_id));
  for (const b of batchOrderRows) orderIds.add(b.order_id);
  const orders = await inIds<{
    id: string;
    po_number: string;
    status: OrderStatus;
    client_id: string | null;
  }>(orderIds, (list) =>
    admin.from("orders").select("id, po_number, status, client_id").in("id", list)
  );
  const orderById = new Map(orders.map((o) => [o.id, o]));

  // Clients: dono da Order (ramo Order) + clientes do PL (ramo PL).
  const clientIds = new Set<string>();
  for (const o of orders) if (o.client_id) clientIds.add(o.client_id);
  for (const pc of plClients) clientIds.add(pc.client_id);
  const clients = await inIds<{ id: string; name: string }>(clientIds, (list) =>
    admin.from("clients").select("id, name").in("id", list)
  );
  const clientNameById = new Map(clients.map((c) => [c.id, c.name]));

  const plNumberById = new Map(preLoadings.map((p) => [p.id, p.pl_number]));
  const shipmentIdByPl = new Map(shipments.map((s) => [s.pre_loading_id, s.id]));

  // POs e clientes consolidados por PL.
  const posByPl = new Map<string, Set<string>>();
  for (const pb of plBatches) {
    const orderId = orderIdByBatch.get(pb.batch_id);
    const po = orderId ? orderById.get(orderId)?.po_number : null;
    if (!po) continue;
    const set = posByPl.get(pb.pre_loading_id) ?? new Set<string>();
    set.add(po);
    posByPl.set(pb.pre_loading_id, set);
  }
  const clientsByPl = new Map<string, { names: Set<string>; ids: Set<string> }>();
  for (const pc of plClients) {
    const entry = clientsByPl.get(pc.pre_loading_id) ?? { names: new Set(), ids: new Set() };
    entry.ids.add(pc.client_id);
    const name = clientNameById.get(pc.client_id);
    if (name) entry.names.add(name);
    clientsByPl.set(pc.pre_loading_id, entry);
  }

  const orderRows: TodoRow[] = orderSteps.flatMap((s) => {
    const order = orderById.get(s.order_id);
    if (!order) return [];
    const clientName = order.client_id ? (clientNameById.get(order.client_id) ?? null) : null;
    return [
      {
        id: s.id,
        po_number: order.po_number,
        pl_number: null,
        step: s.step,
        status: order.status,
        responsible: profile.full_name,
        date_preview: s.estimated_date,
        client: clientName,
        client_ids: order.client_id ? [order.client_id] : [],
        href: `/orders/${order.id}`,
      },
    ];
  });

  const plRows: TodoRow[] = plSteps.map((s) => {
    const pos = posByPl.get(s.pre_loading_id);
    const cl = clientsByPl.get(s.pre_loading_id);
    const shipmentId = shipmentIdByPl.get(s.pre_loading_id);
    return {
      id: s.id,
      po_number: pos ? [...pos].sort().join(", ") : null,
      pl_number: plNumberById.get(s.pre_loading_id) ?? null,
      step: s.step,
      status: null,
      responsible: profile.full_name,
      date_preview: s.estimated_date,
      client: cl ? [...cl.names].sort().join(", ") || null : null,
      client_ids: cl ? [...cl.ids] : [],
      href: shipmentId ? `/shipments/${shipmentId}` : `/pre-loading/${s.pre_loading_id}`,
    };
  });

  const rows = [...orderRows, ...plRows];

  // Opções do filtro Client = só os clientes presentes nas tarefas do usuário.
  const clientOptions: Ref[] = [
    ...new Map(
      rows.flatMap((r) =>
        r.client_ids.map((id) => [id, clientNameById.get(id) ?? "—"] as const)
      )
    ),
  ]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <PageHeader
        title="To do list"
        description="Your pending checklist steps across Orders, Pre-loading and Shipments"
      />
      <TodoClient
        rows={rows}
        clients={clientOptions}
        initialColumns={readColumnVisibility(profile.ui_preferences, "todo")}
      />
    </div>
  );
}
