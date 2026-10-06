import "server-only";

import type { z } from "zod";

import { requireApiFeature, requireApiSession, type ApiSession } from "@/lib/api-auth";
import type { FeatureAction, FeatureKey } from "@/domain/access/features";
import type { WriteResult } from "@/domain/api/write-result";

/**
 * Peças comuns dos Route Handlers REST da integração (orders/{id},
 * order-items, etd-factories/{id}, shipments). Mesmo contrato das rotas que já
 * existiam (app/api/batches): envelope `{data}` / `{data, pagination}` /
 * `{error, issues}` e os mesmos status.
 */

export function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

type Authorized = { ok: true; session: ApiSession } | { ok: false; response: Response };

/**
 * Sessão (token ou cookie) + permissão na feature. `allowPoRead` libera o token
 * só-leitura de PO — que, por decisão, só lê orders; nas demais rotas ele leva
 * 403 explícito, mesmo onde o mapa de features já negaria.
 */
export async function authorize(
  feature: FeatureKey,
  action: FeatureAction,
  opts: { allowPoRead?: boolean } = {}
): Promise<Authorized> {
  const auth = await requireApiSession();
  if (!auth.ok) return auth;
  if (auth.session.tokenScope === "po_read" && !opts.allowPoRead) {
    return { ok: false, response: json({ error: "Forbidden" }, 403) };
  }
  const denied = requireApiFeature(auth.session, feature, action);
  if (denied) return { ok: false, response: denied };
  return auth;
}

/** Erro de validação no formato da API: a 1ª mensagem + todos os issues. */
export function invalid(error: z.ZodError, where: "query" | "body"): Response {
  const issue = error.issues[0];
  const path = issue?.path.join(".");
  const message =
    where === "query" && path
      ? `Invalid '${path}': ${issue?.message}`
      : (issue?.message ?? (where === "query" ? "Invalid query." : "Invalid input."));
  return json({ error: message, issues: error.issues }, 400);
}

/** Lê e valida o body JSON. Body ausente/malformado vira `null` → 400 do schema. */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S
): Promise<{ ok: true; data: z.output<S> } | { ok: false; response: Response }> {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, response: invalid(parsed.error, "body") };
  return { ok: true, data: parsed.data };
}

/** WriteResult → Response. */
export function respond<T>(result: WriteResult<T>): Response {
  return result.ok
    ? json({ data: result.data }, result.status)
    : json({ error: result.error }, result.status);
}

/** Exceção inesperada → 500 com a mensagem. */
export function serverError(err: unknown, fallback: string): Response {
  return json({ error: err instanceof Error ? err.message : fallback }, 500);
}

export function listResponse<T>(
  data: T[],
  total: number,
  page: { limit: number; offset: number }
): Response {
  return json(
    { data, pagination: { limit: page.limit, offset: page.offset, returned: data.length, total } },
    200
  );
}
