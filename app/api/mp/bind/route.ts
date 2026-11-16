import { z } from "zod";

import { json, parseBody, serverError } from "@/lib/api-route";
import { authorizeSupplier, bindWithInvite } from "@/lib/wechat-mp/supplier";

/**
 * Mini Program do fornecedor (docs §6.17) — vínculo com a FÁBRICA.
 *
 *   POST /api/mp/bind  { invite, name }  → { contact, contacts }
 *
 * `invite` = código de 8 caracteres gerado pela equipe na tela da Factory
 * (Registration → Factories → WeChat). Uso único, vale 7 dias.
 */
export const dynamic = "force-dynamic";

const schema = z.strictObject({
  invite: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1, "Please enter your name.").max(80),
});

export async function POST(request: Request): Promise<Response> {
  const auth = await authorizeSupplier(request);
  if (!auth.ok) return auth.response;

  const body = await parseBody(request, schema);
  if (!body.ok) return body.response;

  try {
    const res = await bindWithInvite(auth.admin, auth.openId, body.data.invite, body.data.name);
    if (!res.ok) return json({ error: res.error }, res.status);
    const contacts = [...auth.contacts.filter((c) => c.id !== res.contact.id), res.contact];
    return json({ contact: res.contact, contacts }, 200);
  } catch (err) {
    return serverError(err, "Failed to link.");
  }
}
