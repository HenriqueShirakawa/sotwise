import { NextResponse } from "next/server";

import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";

import type { ShipmentFilterOptions } from "../list-params";

type Ref = { id: string; name: string };

/**
 * GET /shipments/filter-options — opções dos selects do modal de Filters da
 * lista de Shipments. Fora da página (29/10/2026): o cliente busca uma vez em
 * segundo plano e guarda; trocar página/filtro não reenvia mais ~50 kB de
 * cadastros. GET comum (não Server Action) para não entrar na fila do router e
 * segurar a navegação. Cadastros paginados no teto de 1000 (ver lib/fetch-all).
 */
export async function GET() {
  await requireFeature("shipments");
  const admin = createAdminClient();
  const named = (
    table:
      | "pols"
      | "shipment_models"
      | "clients"
      | "order_types"
      | "pods"
      | "agents"
      | "carriers"
      | "factories"
  ) =>
    fetchAll<Ref>((from, to) =>
      admin.from(table).select("id, name").is("deleted_at", null).range(from, to)
    );
  const [pols, shipmentModels, clients, orderTypes, pods, agents, carriers, factories, profileRes, orderRes] =
    await Promise.all([
      named("pols"),
      named("shipment_models"),
      named("clients"),
      named("order_types"),
      named("pods"),
      named("agents"),
      named("carriers"),
      named("factories"),
      // profiles não tem deleted_at — mesma query das outras telas.
      fetchAll<{ id: string; full_name: string | null }>((from, to) =>
        admin.from("profiles").select("id, full_name").range(from, to)
      ),
      fetchAll<{ id: string; po_number: string }>((from, to) =>
        admin.from("orders").select("id, po_number").is("deleted_at", null).range(from, to)
      ),
    ]);

  const byName = (a: Ref, b: Ref) => a.name.localeCompare(b.name);
  const toRefs = (list: Ref[]) => list.map((r) => ({ id: r.id, name: r.name })).sort(byName);
  const options: ShipmentFilterOptions = {
    clients: toRefs(clients),
    profiles: profileRes
      .filter((p) => p.full_name)
      .map((p) => ({ id: p.id, name: p.full_name as string }))
      .sort(byName),
    orders: orderRes
      .map((o) => ({ id: o.id, name: o.po_number }))
      .sort((a, b) => (Number(b.name) || 0) - (Number(a.name) || 0)),
    orderTypes: toRefs(orderTypes),
    agents: toRefs(agents),
    carriers: toRefs(carriers),
    pols: toRefs(pols),
    pods: toRefs(pods),
    factories: toRefs(factories),
    shipmentModels: toRefs(shipmentModels),
  };
  return NextResponse.json(options, { headers: { "Cache-Control": "private, no-store" } });
}
