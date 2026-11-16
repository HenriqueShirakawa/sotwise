import { z } from "zod";

import { json, parseBody, serverError } from "@/lib/api-route";
import { createAdminClient } from "@/lib/supabase/admin";
import { codeToSession, mpConfig } from "@/lib/wechat-mp/client";
import { createSession } from "@/lib/wechat-mp/session";
import { contactsOf } from "@/lib/wechat-mp/supplier";

/**
 * Mini Program do fornecedor (docs §6.17) — entrada.
 *
 *   POST /api/mp/login  { code }  → { token, contacts }
 *
 * `code` = `wx.login()` no celular. Sem sessão do SOT de propósito: o
 * fornecedor não é usuário; quem autentica é o WeChat (code → OpenID).
 * `contacts` vazio = WeChat ainda não vinculado a nenhuma fábrica (o Mini
 * Program mostra a tela de convite).
 */
export const dynamic = "force-dynamic";

const schema = z.strictObject({ code: z.string().trim().min(1).max(200) });

export async function POST(request: Request): Promise<Response> {
  const cfg = mpConfig();
  if (!cfg) return json({ error: "Mini Program is not configured." }, 503);

  const body = await parseBody(request, schema);
  if (!body.ok) return body.response;

  try {
    const session = await codeToSession(cfg, body.data.code);
    if (!session.ok) return json({ error: `WeChat login failed (${session.error}).` }, 401);
    const contacts = await contactsOf(createAdminClient(), session.openId);
    return json({ token: createSession(cfg.sessionSecret, session.openId), contacts }, 200);
  } catch (err) {
    return serverError(err, "Login failed.");
  }
}
