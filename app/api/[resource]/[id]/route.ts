import type { NextRequest } from "next/server";

import { requireApiFeature, requireApiSession } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  GSS_ID_COLUMN,
  IS_ACTIVE_COLUMN,
  RESOURCES,
  readGssId,
  readIsActive,
} from "@/domain/api/registry";

/**
 * PATCH /api/{resource}/{id} — atualiza 1 registro de cadastro de referência.
 *
 * Complementa o handler de coleção (`app/api/[resource]/route.ts`, GET/POST).
 * Não há PUT (substituição total) nem DELETE por decisão: o soft-delete é do
 * app/da origem. O corpo é um objeto JSON PARCIAL — só as colunas enviadas
 * mudam; campos desconhecidos são descartados pelo schema, como no POST.
 * `gss_id` e `is_active` valem para todo recurso e podem vir sozinhos.
 *
 * Mesma allowlist (`RESOURCES`), mesma auth (`requireApiSession`) e mesma
 * feature (`registration`, agora na ação `edit`). Só registros ativos são
 * alcançáveis (`deleted_at IS NULL`); id inexistente/apagado → 404.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Campos comuns a todo recurso, tratados aqui e não no schema de cada um. */
const COMMON_KEYS = new Set([GSS_ID_COLUMN, IS_ACTIVE_COLUMN]);

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

/** Mapeia códigos do Postgres para status HTTP (mesmo mapa do handler de coleção). */
function dbErrorStatus(code?: string): number {
  if (code === "23505") return 409; // unique_violation
  if (code === "23503") return 400; // foreign_key_violation
  return 500;
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ resource: string; id: string }> }
) {
  const { resource, id } = await ctx.params;
  const cfg = RESOURCES[resource];
  if (!cfg) return json({ error: `Unknown resource '${resource}'.` }, 404);

  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const denied = requireApiFeature(auth.session, "registration", "edit");
  if (denied) return denied;

  // Id malformado nunca casa uma linha — trata como inexistente antes de bater
  // no banco (senão o Postgres devolve 22P02 e viraria 500).
  if (!UUID_RE.test(id)) return json({ error: "Record not found." }, 404);

  const body = await request.json().catch(() => null);
  const gssId = readGssId(body);
  if (!gssId.ok) return json({ error: gssId.error }, 400);
  const isActive = readIsActive(body);
  if (!isActive.ok) return json({ error: isActive.error }, 400);

  // Um PATCH só com campos comuns (`{ gss_id }`, `{ is_active }`) não chama o
  // schema do recurso — senão os recursos name-only exigiriam `name` para
  // vincular ou desativar.
  const otherKeys = Object.keys(body && typeof body === "object" ? body : {}).filter(
    (key) => !COMMON_KEYS.has(key)
  );
  const hasCommon = gssId.value !== undefined || isActive.value !== undefined;
  const onlyCommon = hasCommon && otherKeys.length === 0;

  let input: unknown = {};
  if (!onlyCommon) {
    const parsed = cfg.updateSchema.safeParse(body);
    if (!parsed.success) {
      return json(
        {
          error: parsed.error.issues[0]?.message ?? "Invalid input.",
          issues: parsed.error.issues,
        },
        400
      );
    }
    input = parsed.data;
  }
  if (Object.keys(input as object).length === 0 && !hasCommon) {
    return json({ error: "No fields to update." }, 400);
  }

  const admin = createAdminClient();
  const row: Record<string, unknown> = onlyCommon ? {} : cfg.buildUpdate(input);
  if (gssId.value !== undefined) row[GSS_ID_COLUMN] = gssId.value;
  if (isActive.value !== undefined) row[IS_ACTIVE_COLUMN] = isActive.value;
  const select = `${cfg.select}, ${GSS_ID_COLUMN}, ${IS_ACTIVE_COLUMN}`;

  // Se o corpo só mexe em junção (ex.: `contact_ids`), não há coluna para o SET —
  // então confere existência com um SELECT em vez de um UPDATE vazio.
  const { data, error } =
    Object.keys(row).length > 0
      ? await admin
          .from(cfg.table)
          .update(row as never)
          .eq("id", id)
          .is("deleted_at", null)
          .select(select)
          .single()
      : await admin
          .from(cfg.table)
          .select(select)
          .eq("id", id)
          .is("deleted_at", null)
          .single();

  if (error) {
    if (error.code === "PGRST116") return json({ error: "Record not found." }, 404);
    if (error.code === "23505" && gssId.value) {
      return json({ error: `gss_id '${gssId.value}' is already used by another record.` }, 409);
    }
    return json({ error: error.message }, dbErrorStatus(error.code));
  }

  if (cfg.afterUpdate && !onlyCommon) {
    const linkError = await cfg.afterUpdate(id, input, admin);
    if (linkError) return json({ error: linkError }, 500);
  }

  return json({ data }, 200);
}
