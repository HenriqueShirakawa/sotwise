import { json, serverError } from "@/lib/api-route";
import { authorizeSupplier, listSupplierLines } from "@/lib/wechat-mp/supplier";

/**
 * Mini Program do fornecedor (docs §6.17) — as linhas Factory×Category abertas
 * das fábricas a que este WeChat está vinculado.
 *
 *   GET /api/mp/lines  → { contacts, data: SupplierLine[] }
 *
 * Sem Initial Date primeiro (é o que ele precisa responder).
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const auth = await authorizeSupplier(request);
  if (!auth.ok) return auth.response;
  try {
    const data = await listSupplierLines(auth.admin, auth.contacts);
    return json({ contacts: auth.contacts, data }, 200);
  } catch (err) {
    return serverError(err, "Failed to read lines.");
  }
}
