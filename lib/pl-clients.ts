import "server-only";

import type { PlPerClient } from "@/lib/checklist-completion";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

export type PlClient = { id: string; name: string };

/** Etapas com documento por cliente: Shipping Docs (21/10) e BL / Original Docs (22/10). */
export const CLIENT_DOC_STEPS = ["shipping_docs", "bl", "original_docs"] as const;
export type ClientDocStep = (typeof CLIENT_DOC_STEPS)[number];

export const isClientDocStep = (step: string): step is ClientDocStep =>
  (CLIENT_DOC_STEPS as readonly string[]).includes(step);

/** Original Docs de um cliente: Tracking number OU Telex release (22/10/2026). */
export type ClientOriginalDocs = { tracking_number: string | null; telex_release: boolean };

/**
 * Etapas por cliente no PL/Shipment. Os clientes do PL são os das Orders dos
 * lotes que ele consolida (mesma fonte das abas por cliente dos e-mails,
 * lib/email/threads `resolveOwnerOrders`) — não `pre_loading_clients`, que é
 * editada à mão e pode divergir.
 *
 *  - Shipping Docs / BL / Original Docs: documentos do cliente
 *    (`step_attachments.client_id`). Documento antigo, sem cliente (de antes da
 *    regra, ou de quando o PL tinha 1 cliente só), vale para TODOS;
 *  - Booking: NÃO é por cliente — um Booking number único por PL (26/10/2026;
 *    a tabela `pre_loading_client_bookings` de 21/10 ficou sem uso);
 *  - Original Docs: Tracking number / Telex release do cliente;
 *  - Delivered: Delivered date do cliente.
 */
export type PlClientState = {
  clients: PlClient[];
  /** Por etapa: clientes que já têm ao menos um documento. */
  docClientIds: Record<ClientDocStep, Set<string>>;
  /** Por etapa: existe documento sem cliente (vale para todos). */
  hasGeneralDoc: Record<ClientDocStep, boolean>;
  /** Original Docs de cada cliente (`pre_loading_client_original_docs`). */
  originalDocs: Map<string, ClientOriginalDocs>;
  /** Delivered date de cada cliente (`pre_loading_client_delivered`). */
  delivered: Map<string, string>;
};

export async function loadPlClientState(admin: Admin, preLoadingId: string): Promise<PlClientState> {
  const [pbRes, stepsRes, originalRes, deliveredRes] = await Promise.all([
    admin.from("pre_loading_batches").select("batch_id").eq("pre_loading_id", preLoadingId),
    admin
      .from("pre_loading_checklist_steps")
      .select("id, step")
      .eq("pre_loading_id", preLoadingId)
      .in("step", [...CLIENT_DOC_STEPS]),
    admin
      .from("pre_loading_client_original_docs")
      .select("client_id, tracking_number, telex_release")
      .eq("pre_loading_id", preLoadingId),
    admin
      .from("pre_loading_client_delivered")
      .select("client_id, delivered_date")
      .eq("pre_loading_id", preLoadingId),
  ]);
  if (pbRes.error) throw new Error(pbRes.error.message);
  if (stepsRes.error) throw new Error(stepsRes.error.message);
  if (originalRes.error) throw new Error(originalRes.error.message);
  if (deliveredRes.error) throw new Error(deliveredRes.error.message);

  const batchIds = [...new Set((pbRes.data ?? []).map((r) => r.batch_id))];
  let clients: PlClient[] = [];
  if (batchIds.length > 0) {
    const { data: batches, error } = await admin.from("batches").select("order_id").in("id", batchIds);
    if (error) throw new Error(error.message);
    const orderIds = [...new Set((batches ?? []).map((b) => b.order_id))];
    if (orderIds.length > 0) {
      const { data: orders, error: oErr } = await admin
        .from("orders")
        .select("client_id")
        .in("id", orderIds);
      if (oErr) throw new Error(oErr.message);
      const clientIds = [
        ...new Set((orders ?? []).map((o) => o.client_id).filter((id): id is string => !!id)),
      ];
      if (clientIds.length > 0) {
        const { data: rows, error: cErr } = await admin
          .from("clients")
          .select("id, name")
          .in("id", clientIds);
        if (cErr) throw new Error(cErr.message);
        clients = (rows ?? [])
          .map((c) => ({ id: c.id, name: c.name }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }
    }
  }

  const stepRows = stepsRes.data ?? [];

  const docClientIds = Object.fromEntries(
    CLIENT_DOC_STEPS.map((s) => [s, new Set<string>()])
  ) as Record<ClientDocStep, Set<string>>;
  const hasGeneralDoc = Object.fromEntries(CLIENT_DOC_STEPS.map((s) => [s, false])) as Record<
    ClientDocStep,
    boolean
  >;
  const docSteps = stepRows.filter((s) => isClientDocStep(s.step));
  if (docSteps.length > 0) {
    const stepById = new Map(docSteps.map((s) => [s.id, s.step as ClientDocStep]));
    const { data: atts, error } = await admin
      .from("step_attachments")
      .select("pre_loading_step_id, client_id")
      .in("pre_loading_step_id", [...stepById.keys()]);
    if (error) throw new Error(error.message);
    for (const a of atts ?? []) {
      const step = a.pre_loading_step_id ? stepById.get(a.pre_loading_step_id) : undefined;
      if (!step) continue;
      if (a.client_id) docClientIds[step].add(a.client_id);
      else hasGeneralDoc[step] = true;
    }
  }

  const originalDocs = new Map<string, ClientOriginalDocs>();
  for (const o of originalRes.data ?? []) {
    originalDocs.set(o.client_id, { tracking_number: o.tracking_number, telex_release: o.telex_release });
  }
  const delivered = new Map<string, string>();
  for (const d of deliveredRes.data ?? []) delivered.set(d.client_id, d.delivered_date);

  return {
    clients,
    docClientIds,
    hasGeneralDoc,
    originalDocs,
    delivered,
  };
}

/** O cliente tem documento na etapa (dele ou um sem cliente, que vale pra todos)? */
export function clientHasDoc(state: PlClientState, step: ClientDocStep, clientId: string): boolean {
  return state.hasGeneralDoc[step] || state.docClientIds[step].has(clientId);
}

/** Original Docs do cliente cumprido: documento + (Telex release OU Tracking number). */
export function clientOriginalDocsDone(state: PlClientState, clientId: string): boolean {
  const o = state.originalDocs.get(clientId);
  return (
    clientHasDoc(state, "original_docs", clientId) &&
    !!(o?.telex_release || o?.tracking_number?.trim())
  );
}

/** Os números da regra por cliente (lib/checklist-completion `PlPerClient`). */
export function perClientOf(state: PlClientState): PlPerClient {
  const total = state.clients.length;
  const count = (ok: (clientId: string) => boolean) =>
    state.clients.filter((c) => ok(c.id)).length;
  return {
    total,
    withDoc: count((id) => clientHasDoc(state, "shipping_docs", id)),
    withBlDoc: count((id) => clientHasDoc(state, "bl", id)),
    withOriginalDocs: count((id) => clientOriginalDocsDone(state, id)),
    withDelivered: count((id) => state.delivered.has(id)),
  };
}
