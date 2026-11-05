"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { requireInternal } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { BIND_QR_SECONDS, bindScene } from "@/lib/wechat/bind";
import { OUT_OF_WINDOW, createSceneQr, sendCustomText, wechatConfig } from "@/lib/wechat/client";
import { shareInfoText, wechatRef } from "@/lib/wechat/profile-info";

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

/**
 * Estado do vínculo — a tela pergunta de 3 em 3s enquanto espera o celular.
 * (Sem `export type` aqui: arquivo "use server" só exporta funções.)
 */
export async function getMyWechat(): Promise<{
  ref: string | null;
  nickname: string | null;
  avatarUrl: string | null;
}> {
  const { profile } = await requireInternal();
  const { data } = await createAdminClient()
    .from("profiles")
    .select("wechat_openid, wechat_nickname, wechat_avatar_url")
    .eq("id", profile.id)
    .maybeSingle();
  return {
    ref: wechatRef(data?.wechat_openid ?? null),
    nickname: data?.wechat_nickname ?? null,
    avatarUrl: data?.wechat_avatar_url ?? null,
  };
}

/**
 * Manda de novo, pelo robô, o link para a pessoa autorizar nome e foto
 * (abre dentro do WeChat). Só vale para quem já está vinculado.
 */
export async function sendMyWechatInfoLink(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { profile } = await requireInternal();
  const cfg = wechatConfig();
  if (!cfg) return { ok: false, error: "WeChat is not configured." };
  const { data } = await createAdminClient()
    .from("profiles")
    .select("wechat_openid")
    .eq("id", profile.id)
    .maybeSingle();
  if (!data?.wechat_openid) return { ok: false, error: "Link your WeChat first." };

  let origin: string | undefined;
  try {
    origin = (await headers()).get("origin") ?? undefined;
  } catch {
    origin = undefined;
  }
  const text = shareInfoText(cfg, origin);
  if (!text) return { ok: false, error: "No link base configured (WECHAT_LINK_BASE_URL)." };
  const res = await sendCustomText(cfg, data.wechat_openid, text);
  if (!res.ok) {
    return {
      ok: false,
      error: OUT_OF_WINDOW.has(res.errcode ?? 0)
        ? "WeChat only lets us write to you within 48h of your last message. Send any message to the account and try again."
        : `WeChat refused (${res.error}).`,
    };
  }
  return { ok: true };
}

export async function unlinkMyWechat(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { profile } = await requireInternal();
  const { error } = await createAdminClient()
    .from("profiles")
    .update({ wechat_openid: null, wechat_nickname: null, wechat_avatar_url: null })
    .eq("id", profile.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/profile");
  return { ok: true };
}
