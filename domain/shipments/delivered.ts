import { syncOrderStatusForBatches } from "@/lib/order-status";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Conclusão da etapa "Delivered" (#24) encerra a esteira: todos os lotes do
 * embarque vão para `delivered` e o Shipment também (docs §3.10.4). Limpar a
 * data reabre — os lotes voltam para `in_transit`. Usado pela tela de Shipment
 * (saveShipmentStep) e pelo PATCH /api/shipments/{id}/steps/delivered.
 */
export async function applyDeliveredRule(
  admin: Admin,
  shipmentId: string,
  preLoadingId: string,
  delivered: boolean
): Promise<string | null> {
  const { data: links, error: linkError } = await admin
    .from("pre_loading_batches")
    .select("batch_id")
    .eq("pre_loading_id", preLoadingId);
  if (linkError) return linkError.message;

  const batchIds = (links ?? []).map((l) => l.batch_id);
  if (batchIds.length) {
    const { error } = await admin
      .from("batches")
      .update({ status: delivered ? "delivered" : "in_transit" })
      .in("id", batchIds);
    if (error) return error.message;

    // Entrega fecha (ou reabre) a esteira dos lotes: as Orders viram
    // Delivered / Partially Delivered pelo rollup (§3.7.1).
    const statusError = await syncOrderStatusForBatches(admin, batchIds);
    if (statusError) return statusError;
  }

  const { error: shipmentError } = await admin
    .from("shipments")
    .update({ status: delivered ? "delivered" : "in_transit" })
    .eq("id", shipmentId);
  return shipmentError?.message ?? null;
}
