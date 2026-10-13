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
 * API REST genérica para os cadastros de referência.
 *
 *   GET  /api/{resource}?q=&gss_id=&is_active=&limit=&offset=   → lista (deleted_at IS NULL, order name)
 *   POST /api/{resource}                                        → cria 1 registro
 *
 * `{resource}` precisa existir em RESOURCES (allowlist). Autenticação por
 * sessão via requireApiSession() (401/403 JSON). Route handlers não são
 * cacheados por padrão — como tocam banco/cookies, ficam dinâmicos.
 *
 * `gss_id` (o id do registro no GSS) é aceito no POST e devolvido no GET. Com
 * ele o POST é idempotente, como o de orders e lotes: reenvio de um `gss_id`
 * que já existe ATUALIZA o registro (200) em vez de duplicar.
 */

const MAX_LIMIT = 1000;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

/** Mapeia códigos do Postgres para status HTTP. */
function dbErrorStatus(code?: string): number {
  if (code === "23505") return 409; // unique_violation
  if (code === "23503") return 400; // foreign_key_violation
  return 500;
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ resource: string }> }) {
  const { resource } = await ctx.params;
  const cfg = RESOURCES[resource];
  if (!cfg) return json({ error: `Unknown resource '${resource}'.` }, 404);

  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  // Todos os recursos da API são cadastros de Registration.
  const denied = requireApiFeature(auth.session, "registration", "view");
  if (denied) return denied;

  const params = request.nextUrl.searchParams;
  const q = params.get("q")?.trim();
  const gssId = params.get("gss_id")?.trim();
  const limit = Math.min(Number(params.get("limit")) || MAX_LIMIT, MAX_LIMIT);
  const offset = Math.max(Number(params.get("offset")) || 0, 0);
  // `is_active` é filtro opcional; sem ele vêm ativos e inativos.
  const isActive = params.get("is_active");
  if (isActive && isActive !== "true" && isActive !== "false") {
    return json({ error: "is_active must be 'true' or 'false'." }, 400);
  }

  const admin = createAdminClient();
  let query = admin
    .from(cfg.table)
    .select(`${cfg.select}, ${GSS_ID_COLUMN}, ${IS_ACTIVE_COLUMN}`)
    .is("deleted_at", null);
  if (q) query = query.ilike("name", `%${q}%`);
  if (gssId) query = query.eq(GSS_ID_COLUMN, gssId);
  if (isActive) query = query.eq(IS_ACTIVE_COLUMN, isActive === "true");

  const { data, error } = await query.order("name").range(offset, offset + limit - 1);
  if (error) return json({ error: error.message }, dbErrorStatus(error.code));

  return json({ data }, 200);
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ resource: string }> }) {
  const { resource } = await ctx.params;
  const cfg = RESOURCES[resource];
  if (!cfg) return json({ error: `Unknown resource '${resource}'.` }, 404);

  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  const denied = requireApiFeature(auth.session, "registration", "create");
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = cfg.schema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid input.",
        issues: parsed.error.issues,
      },
      400
    );
  }

  const gssId = readGssId(body);
  if (!gssId.ok) return json({ error: gssId.error }, 400);
  const isActive = readIsActive(body);
  if (!isActive.ok) return json({ error: isActive.error }, 400);

  const admin = createAdminClient();
  const select = `${cfg.select}, ${GSS_ID_COLUMN}, ${IS_ACTIVE_COLUMN}`;
  const row = cfg.buildRow(parsed.data, { userId: auth.session.userId });
  if (isActive.value !== undefined) row[IS_ACTIVE_COLUMN] = isActive.value;

  // Idempotência por gss_id: já existe → atualiza (sem mexer em created_by).
  if (gssId.value) {
    const { data: existing, error: lookupError } = await admin
      .from(cfg.table)
      .select("id, deleted_at")
      .eq(GSS_ID_COLUMN, gssId.value)
      .maybeSingle();
    if (lookupError) return json({ error: lookupError.message }, 500);

    if (existing) {
      const found = existing as unknown as { id: string; deleted_at: string | null };
      if (found.deleted_at) {
        return json({ error: `gss_id '${gssId.value}' belongs to a deleted record.` }, 409);
      }
      const update = { ...row };
      delete update.created_by;
      const { data, error } = await admin
        .from(cfg.table)
        .update(update as never)
        .eq("id", found.id)
        .select(select)
        .single();
      if (error) return json({ error: error.message }, dbErrorStatus(error.code));

      if (cfg.afterInsert) {
        const linkError = await cfg.afterInsert(found.id, parsed.data, admin);
        if (linkError) return json({ error: linkError }, 500);
      }
      return json({ data }, 200);
    }
    row[GSS_ID_COLUMN] = gssId.value;
  }

  const { data, error } = await admin
    .from(cfg.table)
    .insert(row as never)
    .select(select)
    .single();
  if (error) return json({ error: error.message }, dbErrorStatus(error.code));

  if (cfg.afterInsert) {
    const linkError = await cfg.afterInsert(
      (data as unknown as { id: string }).id,
      parsed.data,
      admin
    );
    if (linkError) return json({ error: linkError }, 500);
  }

  return json({ data }, 201);
}
