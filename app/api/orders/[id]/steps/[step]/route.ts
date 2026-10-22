import type { NextRequest } from "next/server";

import { authorize, json, parseBody, respond, serverError } from "@/lib/api-route";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveOrderKey } from "@/domain/orders/api-write";
import {
  isOrderApiStep,
  ORDER_API_STEPS,
  orderStepPatchSchemas,
  patchOrderStep,
  readOrderStep,
} from "@/domain/orders/steps-api";

/**
 * Uma etapa do checklist da Order (22/10/2026) — o GSS atualiza o status delas.
 *
 *   GET   /api/orders/{id}/steps/{step}   → estado da etapa + revisões
 *   PATCH /api/orders/{id}/steps/{step}   → o dado que conclui a etapa
 *
 * `{id}`: UUID ou `po_number`. `{step}`: `order` | `pi` | `po`. Regras em
 * domain/orders/steps-api.ts (as mesmas das telas).
 */

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; step: string }> };

const UNKNOWN_STEP = (step: string) =>
  json({ error: `Unknown step '${step}'. Steps: ${ORDER_API_STEPS.join(", ")}.` }, 404);

export async function GET(_request: NextRequest, ctx: Ctx): Promise<Response> {
  const auth = await authorize("orders", "view");
  if (!auth.ok) return auth.response;

  const { id: key, step } = await ctx.params;
  if (!isOrderApiStep(step)) return UNKNOWN_STEP(step);

  try {
    const admin = createAdminClient();
    const id = await resolveOrderKey(admin, key);
    if (!id) return json({ error: "Order not found." }, 404);
    const read = await readOrderStep(admin, id, step);
    return read ? json({ data: read }, 200) : json({ error: "Checklist step not found." }, 404);
  } catch (err) {
    return serverError(err, "Failed to read step.");
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx): Promise<Response> {
  const auth = await authorize("orders", "edit");
  if (!auth.ok) return auth.response;

  const { id: key, step } = await ctx.params;
  if (!isOrderApiStep(step)) return UNKNOWN_STEP(step);

  // Campo de outra etapa (ex.: `pi_status` no `order`) → 400 dizendo qual, antes
  // da validação (senão o erro seria o do campo obrigatório que faltou).
  const schema = orderStepPatchSchemas[step];
  const raw = await request
    .clone()
    .json()
    .catch(() => null);
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const wrong = Object.keys(raw).filter((k) => !(k in schema.shape));
    if (wrong.length) {
      return json({ error: `Step '${step}' doesn't take: ${wrong.join(", ")}.` }, 400);
    }
  }

  const body = await parseBody(request, schema);
  if (!body.ok) return body.response;

  try {
    const admin = createAdminClient();
    const id = await resolveOrderKey(admin, key);
    if (!id) return json({ error: "Order not found." }, 404);
    return respond(await patchOrderStep(admin, id, step, body.data));
  } catch (err) {
    return serverError(err, "Failed to update step.");
  }
}
