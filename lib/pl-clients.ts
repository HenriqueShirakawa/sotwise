import "server-only";

import type { PlPerClient } from "@/lib/checklist-completion";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

export type PlClient = { id: string; name: string };

/**
 * Shipping Docs e Booking por cliente no PL (21/10/2026). Os clientes do PL são
 * os das Orders dos lotes que ele consolida (mesma fonte das abas por cliente
 * dos e-mails, lib/email/threads `resolveOwnerOrders`) — não `pre_loading_clients`,
 * que é editada à mão e pode divergir.
 *
 * Documento / Booking number antigos, sem cliente (de antes da regra, ou de
 * quando o PL tinha 1 cliente só), valem para TODOS os clientes.
 */
export type PlClientState = {
  clients: PlClient[];
  /** Shipping Docs: clientes que já têm ao menos um documento. */
  docClientIds: Set<string>;
  /** Shipping Docs: existe documento sem cliente (vale para todos). */
  hasGeneralDoc: boolean;
  /** Booking number de cada cliente (`pre_loading_client_bookings`). */
  bookings: Map<string, string>;
  /** Booking number da própria etapa (sem cliente — vale para todos). */
  generalBooking: string | null;
};

export async function loadPlClientState(admin: Admin, preLoadingId: string): Promise<PlClientState> {
  const [pbRes, stepsRes, bookingsRes] = await Promise.all([
    admin.from("pre_loading_batches").select("batch_id").eq("pre_loading_id", preLoadingId),
    admin
      .from("pre_loading_checklist_steps")
      .select("id, step, booking_number")
      .eq("pre_loading_id", preLoadingId)
      .in("step", ["shipping_docs", "booking"]),
    admin
      .from("pre_loading_client_bookings")
      .select("client_id, booking_number")
      .eq("pre_loading_id", preLoadingId),
  ]);
  if (pbRes.error) throw new Error(pbRes.error.message);
  if (stepsRes.error) throw new Error(stepsRes.error.message);
  if (bookingsRes.error) throw new Error(bookingsRes.error.message);

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

  const docsStep = (stepsRes.data ?? []).find((s) => s.step === "shipping_docs");
  const bookingStep = (stepsRes.data ?? []).find((s) => s.step === "booking");

  const docClientIds = new Set<string>();
  let hasGeneralDoc = false;
  if (docsStep) {
    const { data: atts, error } = await admin
      .from("step_attachments")
      .select("client_id")
      .eq("pre_loading_step_id", docsStep.id);
    if (error) throw new Error(error.message);
    for (const a of atts ?? []) {
      if (a.client_id) docClientIds.add(a.client_id);
      else hasGeneralDoc = true;
    }
  }

  const bookings = new Map<string, string>();
  for (const b of bookingsRes.data ?? []) {
    if (b.booking_number.trim()) bookings.set(b.client_id, b.booking_number);
  }

  return {
    clients,
    docClientIds,
    hasGeneralDoc,
    bookings,
    generalBooking: bookingStep?.booking_number?.trim() || null,
  };
}

/** Os números da regra por cliente (lib/checklist-completion `PlPerClient`). */
export function perClientOf(state: PlClientState): PlPerClient {
  const total = state.clients.length;
  return {
    total,
    withDoc: state.hasGeneralDoc
      ? total
      : state.clients.filter((c) => state.docClientIds.has(c.id)).length,
    withBooking: state.generalBooking
      ? total
      : state.clients.filter((c) => state.bookings.has(c.id)).length,
  };
}
