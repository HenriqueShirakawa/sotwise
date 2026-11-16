"use server";

import { revalidatePath } from "next/cache";

import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteQrDataUrl, mpConfig } from "@/lib/wechat-mp/client";
import { INVITE_DAYS, newInviteCode } from "@/lib/wechat-mp/session";

/**
 * Contatos da FÁBRICA no Mini Program do WeChat (16/11/2026, docs §6.17): a
 * equipe gera um convite (código + QR), o contato do fornecedor usa no Mini
 * Program e passa a responder ETD / atraso / Ready parts das linhas dessa
 * fábrica. (Sem `export type` aqui: arquivo "use server" só exporta funções.)
 */

export async function getFactoryWechat(factoryId: string): Promise<{
  enabled: boolean;
  contacts: { id: string; name: string; linked_at: string }[];
  invite: { code: string; expires_at: string } | null;
}> {
  await requireFeature("registration", "view");
  const admin = createAdminClient();
  const [{ data: contacts }, { data: invite }] = await Promise.all([
    admin
      .from("factory_wechat_contacts")
      .select("id, name, linked_at")
      .eq("factory_id", factoryId)
      .eq("is_active", true)
      .order("linked_at"),
    admin
      .from("factory_wechat_invites")
      .select("code, expires_at")
      .eq("factory_id", factoryId)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return { enabled: mpConfig() !== null, contacts: contacts ?? [], invite: invite ?? null };
}

export async function createFactoryInvite(factoryId: string): Promise<
  | { ok: true; code: string; expiresAt: string; qrDataUrl: string | null; qrError: string | null }
  | { ok: false; error: string }
> {
  const session = await requireFeature("registration", "edit");
  const cfg = mpConfig();
  if (!cfg) return { ok: false, error: "The WeChat Mini Program is not configured." };

  const admin = createAdminClient();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 3600 * 1000).toISOString();

  // Código colidindo com outro ainda livre (índice único) → tenta de novo.
  let code = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    code = newInviteCode();
    const { error } = await admin.from("factory_wechat_invites").insert({
      factory_id: factoryId,
      code,
      created_by: session.userId,
      expires_at: expiresAt,
    });
    if (!error) break;
    if (error.code !== "23505" || attempt === 4) return { ok: false, error: error.message };
  }

  // O QR abre o Mini Program já com o convite (scene ≤ 32 caracteres).
  const qr = await inviteQrDataUrl(cfg, `i=${code}`);
  return {
    ok: true,
    code,
    expiresAt,
    qrDataUrl: qr.ok ? qr.dataUrl : null,
    qrError: qr.ok ? null : qr.error,
  };
}

export async function unlinkFactoryContact(contactId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireFeature("registration", "edit");
  const { error } = await createAdminClient()
    .from("factory_wechat_contacts")
    .update({ is_active: false, unlinked_at: new Date().toISOString(), unlinked_by: session.userId })
    .eq("id", contactId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/registration/factories");
  return { ok: true };
}
