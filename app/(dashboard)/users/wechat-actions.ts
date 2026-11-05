"use server";

import { revalidatePath } from "next/cache";

import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { BIND_QR_SECONDS, bindScene } from "@/lib/wechat/bind";
import { createSceneQr, wechatConfig } from "@/lib/wechat/client";

/**
 * Vínculo com o WeChat (Service Account) em Users → Edit. O OpenID não é
 * digitável: o admin gera um QR temporário, a pessoa escaneia com o WeChat e o
 * callback (`lib/wechat/inbound.ts`) grava o vínculo. A tela pergunta de tempos
 * em tempos se já vinculou.
 */

async function eligibleProfile(userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("status, role_id")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return { ok: false, error: "User not found." };
  if (profile.status !== "active") return { ok: false, error: "Unblock the user first." };
  const { data: role } = await admin.from("roles").select("name").eq("id", profile.role_id).maybeSingle();
  if (role?.name === "client") return { ok: false, error: "WeChat is for the internal team only." };
  return { ok: true };
}

export async function createWechatLinkQr(
  userId: string
): Promise<{ ok: true; imageUrl: string; expiresInSeconds: number } | { ok: false; error: string }> {
  await requireFeature("users", "edit");
  const cfg = wechatConfig();
  if (!cfg) return { ok: false, error: "WeChat is not configured." };

  const eligible = await eligibleProfile(userId);
  if (!eligible.ok) return eligible;

  const qr = await createSceneQr(cfg, bindScene(userId), BIND_QR_SECONDS);
  if (!qr.ok) return { ok: false, error: `WeChat refused the QR code (${qr.error}).` };
  return { ok: true, imageUrl: qr.imageUrl, expiresInSeconds: BIND_QR_SECONDS };
}

export async function getWechatLinked(userId: string): Promise<boolean> {
  await requireFeature("users", "edit");
  const { data } = await createAdminClient()
    .from("profiles")
    .select("wechat_openid")
    .eq("id", userId)
    .maybeSingle();
  return !!data?.wechat_openid;
}

export async function unlinkWechat(userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireFeature("users", "edit");
  const { error } = await createAdminClient()
    .from("profiles")
    .update({ wechat_openid: null })
    .eq("id", userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/users");
  return { ok: true };
}
