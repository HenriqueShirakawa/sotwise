import { STEP_LABELS } from "@/lib/checklist";
import { isStepChecked, plStepFacts } from "@/lib/checklist-completion";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { ChecklistStep } from "@/types/database";

/**
 * "Confirm Shipping": converte um Pre-loading concluído num Shipment (regra
 * 3.9.6). Usado pelo botão da tela
 * (app/(dashboard)/pre-loading/[id]/actions.ts → confirmShipping) e pelo
 * PATCH /api/shipments/{id} com `status: "in_transit"`.
 *
 * Cria o shipment 1:1, grava o loading_status de cada entrada Factory×Category
 * (e o snapshot do que este embarque carregou, em shipment_loaded_lines) e leva
 * todos os lotes do PL para `in_transit`. SEM split (13/10/2026): o SOT não
 * cria lote — a entrada Partial/None fica no lote que embarcou, com o status
 * gravado. Quem decide se existe um lote seguinte é o GSS, que enxerga o nível
 * produto (quantidade) e cria o lote pela API (POST /api/batches).
 * Por fim marca o PL como confirmado (sai da lista de Pre-loading).
 *
 * A validação (campos, checklist, cobertura de status) roda aqui; a escrita em
 * si é uma chamada RPC atômica — `confirm_shipping_no_split`, ver
 * supabase/migrations/20261013120000_confirm_shipping_no_split.sql. Uma falha
 * no meio desfaz tudo.
 */

type Admin = ReturnType<typeof createAdminClient>;

export const PL_STEPS: ChecklistStep[] = [
  "consolidation_point",
  "city",
  "port_of_loading",
  "shipping_docs",
  "agents",
  "booking",
  "loading_date",
];

export type ConfirmShippingInput = {
  container_number: string;
  seal_number: string;
  estimated_date: string; // yyyy-mm-dd — espelha loading_date.estimated_date do checklist
  /** Completed on da etapa "loading_date" do checklist — revisável neste popup. */
  loading_date_completed_on: string; // yyyy-mm-dd
  shipment_leader_id: string;
  preloading_leader_id: string;
  carrier_id: string;
  shipment_model_id: string;
  signer_id: string;
  /** loading_status por entrada order_factory_category (None/Partial/Total). */
  statuses: { ofc_id: string; status: "none" | "partial" | "total" }[];
};

export type ConfirmShippingResult =
  | { ok: true; shipment_id: string | null; changed_order_ids: string[] }
  | { ok: false; status: 400 | 404 | 409 | 500; error: string };

export async function confirmShippingRecord(
  admin: Admin,
  preLoadingId: string,
  input: ConfirmShippingInput,
  createdBy: string | null
): Promise<ConfirmShippingResult> {
  const required = [
    input.container_number,
    input.seal_number,
    input.estimated_date,
    input.loading_date_completed_on,
    input.shipment_leader_id,
    input.preloading_leader_id,
    input.carrier_id,
    input.shipment_model_id,
    input.signer_id,
  ];
  if (required.some((v) => !v || !String(v).trim())) {
    return { ok: false, status: 400, error: "Fill in all required fields." };
  }
  const VALID = new Set(["none", "partial", "total"]);
  if (input.statuses.some((s) => !VALID.has(s.status))) {
    return { ok: false, status: 400, error: "Each line must be None, Partial or Total." };
  }

  const { data: pl, error: plErr } = await admin
    .from("pre_loadings")
    .select("id, shipping_confirmed_at")
    .eq("id", preLoadingId)
    .is("deleted_at", null)
    .maybeSingle();
  if (plErr) return { ok: false, status: 500, error: plErr.message };
  if (!pl) return { ok: false, status: 404, error: "Pre-loading not found." };
  if (pl.shipping_confirmed_at) {
    return { ok: false, status: 409, error: "This Pre-loading was already shipped." };
  }

  // Reforça no servidor a trava do botão: as 7 etapas concluídas — pela regra
  // completa (data + documento/cadastro/booking), não só pelo "Completed on".
  const { data: steps } = await admin
    .from("pre_loading_checklist_steps")
    .select(
      "id, step, completed_on, consolidation_point_id, city_id, pol_id, carrier_id, agent_brazil_id, agent_china_id, contact_brazil_id, contact_china_id, booking_number"
    )
    .eq("pre_loading_id", preLoadingId);

  const stepIds = (steps ?? []).map((s) => s.id);
  const { data: attachments } = stepIds.length
    ? await admin
        .from("step_attachments")
        .select("pre_loading_step_id")
        .in("pre_loading_step_id", stepIds)
    : { data: [] };
  const attachmentCount = new Map<string, number>();
  for (const a of attachments ?? []) {
    if (!a.pre_loading_step_id) continue;
    attachmentCount.set(
      a.pre_loading_step_id,
      (attachmentCount.get(a.pre_loading_step_id) ?? 0) + 1
    );
  }

  const byStep = new Map((steps ?? []).map((s) => [s.step, s]));

  // Contatos dos agentes escolhidos: sem nenhum cadastrado, Contact Brazil /
  // Contact China deixam de ser exigência da etapa Agents (mesma regra da tela).
  const agentsStep = byStep.get("agents");
  const agentIds = [agentsStep?.agent_brazil_id, agentsStep?.agent_china_id].filter(
    (id): id is string => !!id
  );
  const { data: agentContacts } = agentIds.length
    ? await admin.from("agent_contacts").select("agent_id").in("agent_id", agentIds)
    : { data: [] };
  const contactCountByAgent: Record<string, number> = {};
  for (const ac of agentContacts ?? []) {
    contactCountByAgent[ac.agent_id] = (contactCountByAgent[ac.agent_id] ?? 0) + 1;
  }

  const pending = PL_STEPS.filter((step) => {
    const s = byStep.get(step);
    if (!s) return true;
    return !isStepChecked(
      step,
      plStepFacts(s, attachmentCount.get(s.id) ?? 0, contactCountByAgent)
    );
  });
  if (pending.length > 0) {
    return {
      ok: false,
      status: 409,
      error: `Complete all checklist steps before shipping — still open: ${pending
        .map((s) => STEP_LABELS[s])
        .join(", ")}.`,
    };
  }

  const { data: plBatches } = await admin
    .from("pre_loading_batches")
    .select("batch_id")
    .eq("pre_loading_id", preLoadingId);
  const batchIds = (plBatches ?? []).map((b) => b.batch_id);
  if (batchIds.length === 0) {
    return { ok: false, status: 409, error: "This Pre-loading has no batches." };
  }

  const { data: ofcRows } = await admin
    .from("order_factory_category")
    .select("id, batch_id, order_id")
    .in("batch_id", batchIds);

  const statusByOfc = new Map(input.statuses.map((s) => [s.ofc_id, s.status]));
  if ((ofcRows ?? []).some((o) => !statusByOfc.has(o.id))) {
    return { ok: false, status: 400, error: "Set the loading status for every line." };
  }

  // Lote nunca sai com TODAS as entradas None — nada embarcou dele (regra do
  // usuário, 30/09/2026; o popup já esconde/trava o None). Sem isto o lote vazio
  // ia para In Transit e a Order virava Partially Shipped sem nada a bordo.
  const statusesByBatch = new Map<string, string[]>();
  for (const o of ofcRows ?? []) {
    if (!o.batch_id) continue;
    statusesByBatch.set(o.batch_id, [
      ...(statusesByBatch.get(o.batch_id) ?? []),
      statusByOfc.get(o.id)!,
    ]);
  }
  if ([...statusesByBatch.values()].some((list) => list.every((s) => s === "none"))) {
    return {
      ok: false,
      status: 409,
      error: "A batch can't ship with every line as None — set at least one line to Partial or Total.",
    };
  }

  // Shipment + loading_status + snapshot + lotes em in_transit + completed_on
  // do checklist + confirma o PL — tudo numa função de banco (RPC), rodando
  // como uma única transação: uma falha no meio desfaz tudo, em vez de deixar
  // o shipment órfão. Ver
  // supabase/migrations/20261013120000_confirm_shipping_no_split.sql.
  const { data: rpcResult, error: rpcError } = await admin.rpc("confirm_shipping_no_split", {
    p_pre_loading_id: preLoadingId,
    p_container_number: input.container_number.trim(),
    p_seal_number: input.seal_number.trim(),
    p_estimated_date: input.estimated_date,
    p_loading_date_completed_on: input.loading_date_completed_on,
    p_shipment_leader_id: input.shipment_leader_id,
    p_preloading_leader_id: input.preloading_leader_id,
    p_carrier_id: input.carrier_id,
    p_shipment_model_id: input.shipment_model_id,
    p_signer_id: input.signer_id,
    p_created_by: createdBy,
    p_statuses: input.statuses,
  });
  if (rpcError) return { ok: false, status: 409, error: rpcError.message };

  return {
    ok: true,
    shipment_id: rpcResult?.shipment_id ?? null,
    changed_order_ids: rpcResult?.changed_order_ids ?? [],
  };
}
