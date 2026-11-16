import { z } from "zod";

import { apiDay } from "@/lib/api-dates";
import { json, parseBody, serverError } from "@/lib/api-route";
import { isUuid } from "@/domain/api/write-result";
import { patchEtd } from "@/domain/etd-factories/api-write";
import { authorizeSupplier, listSupplierLines } from "@/lib/wechat-mp/supplier";

/**
 * Mini Program do fornecedor (docs §6.17) — o fornecedor grava o ETD de UMA
 * linha da fábrica dele.
 *
 *   PATCH /api/mp/lines/{id}
 *     { initial_date }                 → informa a ETD (só se vazia)
 *     { current_date, remarks }        → avisa atraso (motivo obrigatório)
 *     { ready_date [, remarks] }       → Ready parts (data real; null desfaz, com motivo)
 *
 * Mesmas regras da tela e da API (domain/etd-factories/api-write.ts → patchEtd);
 * o `etd_history` grava a origem "supplier" com o nome do contato.
 */
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const schema = z
  .strictObject({
    initial_date: apiDay.optional(),
    current_date: apiDay.optional(),
    ready_date: apiDay.nullable().optional(),
    remarks: z.string().trim().min(1, "Please write the reason.").max(2000).optional(),
  })
  .refine(
    (v) => v.initial_date !== undefined || v.current_date !== undefined || v.ready_date !== undefined,
    { error: "Nothing to update." }
  );

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const auth = await authorizeSupplier(request);
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ error: "Item not found." }, 404);

  const body = await parseBody(request, schema);
  if (!body.ok) return body.response;

  try {
    // Posse: a linha precisa estar entre as linhas abertas das fábricas dele.
    const [line] = await listSupplierLines(auth.admin, auth.contacts, id);
    if (!line) return json({ error: "Item not found." }, 404);
    const contact = auth.contacts.find((c) => c.factory_id === line.factory_id);

    const res = await patchEtd(auth.admin, null, id, body.data, {
      source: "supplier",
      contactName: contact?.name ?? "supplier",
    });
    if (!res.ok) return json({ error: res.error }, res.status);

    const [updated] = await listSupplierLines(auth.admin, auth.contacts, id);
    return json({ data: updated ?? line }, 200);
  } catch (err) {
    return serverError(err, "Failed to update ETD.");
  }
}
