"use server";

import { revalidatePath } from "next/cache";

import { requireInternal } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { BIND_QR_SECONDS, bindScene } from "@/lib/wechat/bind";
import { createSceneQr, wechatConfig } from "@/lib/wechat/client";

/**
 * Vínculo com o WeChat em My profile: cada pessoa da equipe escaneia o PRÓPRIO
 * QR com o PRÓPRIO celular. O OpenID não é digitável — o QR temporário leva o
 * id do perfil e o callback (`lib/wechat/inbound.ts`) grava o vínculo. Cliente
 * nunca chega aqui (`requireInternal` manda pro portal).
 */

export async function createMyWechatQr(): Promise<
  { ok: true; imageUrl: string; expiresInSeconds: number } | { ok: false; error: string }
> {
  const { profile } = await requireInternal();
  const cfg = wechatConfig();
  if (!cfg) return { ok: false, error: "WeChat is not configured." };
  if (profile.status !== "active") return { ok: false, error: "Your user is not active." };

  const qr = await createSceneQr(cfg, bindScene(profile.id), BIND_QR_SECONDS);
  if (!qr.ok) return { ok: false, error: `WeChat refused the QR code (${qr.error}).` };
  return { ok: true, imageUrl: qr.imageUrl, expiresInSeconds: BIND_QR_SECONDS };
}

export async function isMyWechatLinked(): Promise<boolean> {
  const { profile } = await requireInternal();
  const { data } = await createAdminClient()
    .from("profiles")
    .select("wechat_openid")
    .eq("id", profile.id)
    .maybeSingle();
  return !!data?.wechat_openid;
}

export async function unlinkMyWechat(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { profile } = await requireInternal();
  const { error } = await createAdminClient()
    .from("profiles")
    .update({ wechat_openid: null })
    .eq("id", profile.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/profile");
  return { ok: true };
}
