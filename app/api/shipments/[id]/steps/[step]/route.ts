import type { NextRequest } from "next/server";

import { authorize, json, parseBody, respond, serverError } from "@/lib/api-route";
import { SHIPMENT_STEPS } from "@/lib/checklist";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveShipmentKey } from "@/domain/shipments/api-read";
import { patchStepSchema } from "@/domain/shipments/api-schema";
import { patchShipmentStep } from "@/domain/shipments/api-write";
import type { ChecklistStep } from "@/types/database";

/**
 * Uma etapa do checklist do PL/Shipment.
 *
 *   PATCH /api/shipments/{id}/steps/{step}
 *
 * `{step}`: consolidation_point, city, port_of_loading, shipping_docs, agents,
 * booking, loading_date (Pre-loading) | shipping_date, bl, original_docs,
 * inspection_report, eta_brazil, ata_brazil, delivered (Shipment — só depois
 * do Confirm Shipping). Mesmas regras das telas: "Completed on" não é futura e
 * exige "Estimated date"; concluir Delivered entrega lotes e embarque. Anexos
 * continuam só na tela. Devolve o registro do /api/shipments/{id}.
 */

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; step: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { id: key, step } = await ctx.params;
  // Etapa de Shipment = feature shipments (como a tela de Shipment); as do PL = pre_loading.
  const isShipmentStep = SHIPMENT_STEPS.includes(step as ChecklistStep);
  const auth = await authorize(isShipmentStep ? "shipments" : "pre_loading", "edit");
  if (!auth.ok) return auth.response;

  const body = await parseBody(request, patchStepSchema);
  if (!body.ok) return body.response;

  try {
    const admin = createAdminClient();
    const id = await resolveShipmentKey(admin, key);
    if (!id) return json({ error: "Pre-loading not found." }, 404);
    return respond(
      await patchShipmentStep(
        admin,
        { userId: auth.session.userId, isAdmin: auth.session.isAdmin },
        id,
        step,
        body.data
      )
    );
  } catch (err) {
    return serverError(err, "Failed to update step.");
  }
}
