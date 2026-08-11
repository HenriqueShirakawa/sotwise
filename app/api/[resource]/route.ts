import type { NextRequest } from "next/server";

import { requireApiFeature, requireApiSession } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { RESOURCES } from "@/domain/api/registry";

/**
 * API REST genérica para os cadastros de referência.
 *
 *   GET  /api/{resource}?q=&limit=&offset=   → lista (deleted_at IS NULL, order name)
 *   POST /api/{resource}                     → cria 1 registro
 *
 * `{resource}` precisa existir em RESOURCES (allowlist). Autenticação por
 * sessão via requireApiSession() (401/403 JSON). Route handlers não são
 * cacheados por padrão — como tocam banco/cookies, ficam dinâmicos.
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
  const limit = Math.min(Number(params.get("limit")) || MAX_LIMIT, MAX_LIMIT);
  const offset = Math.max(Number(params.get("offset")) || 0, 0);

  const admin = createAdminClient();
  let query = admin.from(cfg.table).select(cfg.select).is("deleted_at", null);
  if (q) query = query.ilike("name", `%${q}%`);

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

  const admin = createAdminClient();
  const row = cfg.buildRow(parsed.data, { userId: auth.session.userId });
  const { data, error } = await admin
    .from(cfg.table)
    .insert(row as never)
    .select(cfg.select)
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
