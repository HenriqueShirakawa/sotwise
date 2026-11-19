import type { BatchStatus } from "@/types/database";

/**
 * "Correct shipment" (19/11/2026, pedido do usuário: "o pessoal passa de PL
 * para shipment e erra um monte de coisas"). Depois do Confirm, admin/owner
 * reabre os MESMOS campos do popup do Confirm (container, seal, Loading Date,
 * leaders, carrier, modelo, signer) e os lotes do embarque — com motivo
 * obrigatório, que vai pro History da etapa Loading Date.
 *
 * Aqui só a regra (sem banco), para o teste unitário; a gravação mora em
 * domain/shipments/correct.ts.
 */

/** Campos do popup do Confirm que a correção reabre. */
export type ShipmentHeaderValues = {
  container_number: string;
  seal_number: string;
  /** Loading Date REAL (event_date da etapa loading_date). */
  loading_date: string;
  shipment_leader_id: string;
  preloading_leader_id: string;
  carrier_id: string;
  shipment_model_id: string;
  signer_id: string;
};

export type ShipmentHeaderField = keyof ShipmentHeaderValues;

export const SHIPMENT_HEADER_FIELDS: ShipmentHeaderField[] = [
  "container_number",
  "seal_number",
  "loading_date",
  "shipment_leader_id",
  "preloading_leader_id",
  "carrier_id",
  "shipment_model_id",
  "signer_id",
];

/** Campo do formulário → chave no History (lib/checklist-step-log-actions). */
export const HEADER_LOG_KEY: Record<ShipmentHeaderField, string> = {
  container_number: "container_number",
  seal_number: "seal_number",
  loading_date: "event_date",
  shipment_leader_id: "shipment_leader_id",
  preloading_leader_id: "preloading_leader_id",
  carrier_id: "carrier_id",
  shipment_model_id: "shipment_model_id",
  signer_id: "signer_id",
};

export type ShipmentCorrectionInput = ShipmentHeaderValues & {
  /** Conjunto FINAL de lotes do embarque. */
  batch_ids: string[];
  reason: string;
};

export type CurrentShipmentState = {
  /** shipments.status: in_transit | delivered. */
  status: string;
  header: Record<ShipmentHeaderField, string | null>;
  batches: { id: string; status: BatchStatus; label: string }[];
};

export type CorrectionPlan = {
  header: Partial<Record<ShipmentHeaderField, { from: string | null; to: string }>>;
  added: string[];
  removed: string[];
  reason: string;
};

export const CORRECTION_REASON_REQUIRED = "Write the reason for the correction.";
export const CORRECTION_NOTHING_CHANGED = "Nothing to correct.";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Texto livre (container/seal) compara sem espaço nas pontas. */
const TEXT_FIELDS: ReadonlySet<ShipmentHeaderField> = new Set(["container_number", "seal_number"]);

export function planShipmentCorrection(
  current: CurrentShipmentState,
  input: ShipmentCorrectionInput,
  today: string
): { ok: true; plan: CorrectionPlan } | { ok: false; error: string } {
  const reason = (input.reason ?? "").trim();
  if (!reason) return { ok: false, error: CORRECTION_REASON_REQUIRED };

  const values = Object.fromEntries(
    SHIPMENT_HEADER_FIELDS.map((f) => [f, String(input[f] ?? "").trim()])
  ) as ShipmentHeaderValues;
  // Obrigatórios como no Confirm, mas embarque legado (Bubble) pode ter campo
  // que nunca foi preenchido: esse pode seguir vazio. O que tem valor não some.
  if (SHIPMENT_HEADER_FIELDS.some((f) => !values[f] && (current.header[f] ?? "").trim() !== "")) {
    return { ok: false, error: "Fill in all required fields." };
  }
  if (values.loading_date && !ISO_DATE.test(values.loading_date)) {
    return { ok: false, error: "Choose the loading date." };
  }
  if (values.loading_date && values.loading_date > today) {
    return { ok: false, error: "The loading date can't be in the future." };
  }

  const finalIds = [...new Set(input.batch_ids ?? [])].filter(Boolean);
  if (finalIds.length === 0) return { ok: false, error: "A shipment needs at least one batch." };

  const currentIds = new Set(current.batches.map((b) => b.id));
  const added = finalIds.filter((id) => !currentIds.has(id));
  const removed = current.batches.filter((b) => !finalIds.includes(b.id));

  if ((added.length > 0 || removed.length > 0) && current.status === "delivered") {
    return { ok: false, error: "A delivered shipment can't change its batches." };
  }
  // Lote já entregue fica: tirar do embarque o devolveria a In Production.
  const delivered = removed.filter((b) => b.status !== "in_transit");
  if (delivered.length > 0) {
    return {
      ok: false,
      error: `Only In Transit batches can leave the shipment: ${delivered.map((b) => b.label).join(", ")}.`,
    };
  }

  const header: CorrectionPlan["header"] = {};
  for (const f of SHIPMENT_HEADER_FIELDS) {
    const from = current.header[f];
    const before = TEXT_FIELDS.has(f) ? (from ?? "").trim() : (from ?? "");
    if (before !== values[f]) header[f] = { from: from ?? null, to: values[f] };
  }

  if (Object.keys(header).length === 0 && added.length === 0 && removed.length === 0) {
    return { ok: false, error: CORRECTION_NOTHING_CHANGED };
  }

  return { ok: true, plan: { header, added, removed: removed.map((b) => b.id), reason } };
}

/** Lote que alguém tenta pôr no embarque pela correção. */
export type AddableBatchFacts = {
  label: string;
  status: BatchStatus;
  is_active: boolean;
  quantities_confirmed: boolean;
  /** Nº do PL vivo que já tem o lote (null = livre). */
  pl_number: string | null;
};

/**
 * Mesma régua do Confirm: só entra lote In Production, livre de outro PL e
 * com as quantidades confirmadas pelo GSS (quantities_confirmed).
 */
export function addBatchError(facts: AddableBatchFacts | undefined): string | null {
  if (!facts) return "Batch not found.";
  if (!facts.is_active) return `Batch ${facts.label} is inactive.`;
  if (facts.pl_number) return `Batch ${facts.label} is already in PL - ${facts.pl_number}.`;
  if (facts.status !== "in_production") {
    return `Batch ${facts.label} must be In Production to join the shipment.`;
  }
  if (!facts.quantities_confirmed) {
    return `Waiting for GSS to confirm the quantities of ${facts.label}.`;
  }
  return null;
}
