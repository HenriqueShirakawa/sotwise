import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Histórico do ETD (`etd_history`) — usado pelas DUAS edições da tela (modal
 * "ETD update" e edição rápida na linha, app/(dashboard)/orders/[id]/actions.ts)
 * e pelo PATCH /api/etd-factories/{id} (domain/etd-factories/api-write.ts).
 */

export type EtdHistorySnapshot = {
  field:
    | "current_date"
    | "ready"
    | "inspection"
    | "initial_date"
    | "dispatch_location_id"
    | "dispatch_date";
  /**
   * Por onde a alteração passou. Ausente nas linhas gravadas antes de a edição
   * na linha passar a ser auditada — nessa época só o modal escrevia histórico,
   * então `undefined` se lê como "modal". `api` = integração (GSS).
   */
  source?: "modal" | "row" | "api";
  inspection: boolean;
  ready: boolean;
  remarks: string | null;
  initial_date: string | null;
  current_date: string | null;
  dispatch_location_name: string | null;
  dispatch_date: string | null;
};

/** Estado de `etd_info` recém-salvo, na forma que o snapshot precisa. */
export type EtdSavedState = {
  id: string;
  inspection: boolean;
  ready: boolean;
  remarks: string | null;
  initial_date: string | null;
  current_date: string | null;
  dispatch_location_id: string | null;
  dispatch_date: string | null;
};

export const ETD_SAVED_COLUMNS =
  "id, inspection, ready, remarks, initial_date, current_date, dispatch_location_id, dispatch_date";

/**
 * Grava uma linha de `etd_history` por campo alterado, com o snapshot completo
 * do estado já persistido em `etd_info`. Ready e Inspection são campos
 * sensíveis: mudança sem rastro de quem/quando não é aceitável, mesmo quando
 * feita sem motivo declarado. `userId` null = token de serviço (integração).
 * Retorna a mensagem de erro, ou null em caso de sucesso.
 */
export async function writeEtdHistory(
  admin: ReturnType<typeof createAdminClient>,
  saved: EtdSavedState,
  fields: EtdHistorySnapshot["field"][],
  source: NonNullable<EtdHistorySnapshot["source"]>,
  userId: string | null
): Promise<string | null> {
  if (fields.length === 0) return null;

  let dispatchLocationName: string | null = null;
  if (saved.dispatch_location_id) {
    const { data: factory } = await admin
      .from("factories")
      .select("name")
      .eq("id", saved.dispatch_location_id)
      .maybeSingle();
    dispatchLocationName = factory?.name ?? null;
  }

  const { error } = await admin.from("etd_history").insert(
    fields.map((field) => ({
      etd_info_id: saved.id,
      changed_fields: {
        field,
        source,
        inspection: saved.inspection,
        ready: saved.ready,
        remarks: saved.remarks,
        initial_date: saved.initial_date,
        current_date: saved.current_date,
        dispatch_location_name: dispatchLocationName,
        dispatch_date: saved.dispatch_date,
      } satisfies EtdHistorySnapshot,
      changed_by: userId,
    }))
  );
  return error?.message ?? null;
}
