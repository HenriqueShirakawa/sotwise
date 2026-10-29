import { NextResponse } from "next/server";

import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";

import type { PreLoadingOptions } from "../pre-loading-client";

type Ref = { id: string; name: string };

/**
 * GET /pre-loading/options — opções dos filtros e dos selects do modal da lista
 * de Pre-Loading. Fora da página (29/10/2026): a lista aparece primeiro e o
 * cliente busca isto em segundo plano. GET comum (não Server Action) para não
 * entrar na fila do router. Cadastros paginados no teto de 1000 (lib/fetch-all).
 */
export async function GET() {
  await requireFeature("pre_loading");
  const admin = createAdminClient();
  const named = (table: "clients" | "agents" | "carriers" | "pols" | "pods" | "factories") =>
    fetchAll<Ref>((from, to) =>
      admin.from(table).select("id, name").is("deleted_at", null).range(from, to)
    );
  const [clients, agents, carriers, pols, pods, factories, profileRes, orderRes] =
    await Promise.all([
      named("clients"),
      named("agents"),
      named("carriers"),
      named("pols"),
      named("pods"),
      named("factories"),
      fetchAll<{ id: string; full_name: string | null }>((from, to) =>
        admin.from("profiles").select("id, full_name").range(from, to)
      ),
      fetchAll<{ id: string; po_number: string }>((from, to) =>
        admin.from("orders").select("id, po_number").is("deleted_at", null).range(from, to)
      ),
    ]);

  const byName = (a: Ref, b: Ref) => a.name.localeCompare(b.name);
  const toRefs = (list: Ref[]) => list.map((r) => ({ id: r.id, name: r.name })).sort(byName);
  const options: PreLoadingOptions = {
    clients: toRefs(clients),
    profiles: profileRes
      .filter((p) => p.full_name)
      .map((p) => ({ id: p.id, name: p.full_name as string }))
      .sort(byName),
    agents: toRefs(agents),
    carriers: toRefs(carriers),
    pols: toRefs(pols),
    pods: toRefs(pods),
    factories: toRefs(factories),
    orders: orderRes
      .map((o) => ({ id: o.id, name: o.po_number }))
      .sort((a, b) => (Number(b.name) || 0) - (Number(a.name) || 0)),
  };
  return NextResponse.json(options, { headers: { "Cache-Control": "private, no-store" } });
}
