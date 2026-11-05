import { createAdminClient } from "@/lib/supabase/admin";
import { userInfoFromCode, wechatConfig } from "@/lib/wechat/client";

/**
 * Volta da autorização de página do WeChat (snsapi_userinfo). A pessoa abriu o
 * link que o robô mandou, tocou em "permitir" e o WeChat a trouxe aqui com
 * `?code=`. O OpenID vem do próprio WeChat na troca do code — então só dá para
 * gravar nome/foto no usuário que JÁ está vinculado a esse WeChat; ninguém
 * consegue escrever no perfil de outro.
 *
 * Responde uma página simples (é aberta dentro do WeChat, sem login no SOT).
 */
export const dynamic = "force-dynamic";

function page(title: string, text: string, status = 200): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SOT</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:48px 24px;text-align:center;color:#1e1b2e;background:#faf8ff}h1{color:#640BB7;font-size:22px}p{line-height:1.5;white-space:pre-line}</style></head>
<body><h1>${title}</h1><p>${text}</p></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(request: Request): Promise<Response> {
  const cfg = wechatConfig();
  if (!cfg) return page("SOT", "WeChat is not configured.\n微信未配置。", 404);

  const code = new URL(request.url).searchParams.get("code");
  if (!code) {
    return page("Not shared · 未授权", "Nothing was shared. You can close this page.\n未授权,可以关闭此页面。");
  }

  const info = await userInfoFromCode(cfg, code);
  if (!info.ok) {
    console.error("[wechat] oauth falhou:", info.error);
    return page("Error · 出错了", "Could not read your WeChat profile. Try the link again.\n无法读取微信资料,请重新打开链接。", 502);
  }

  const { data, error } = await createAdminClient()
    .from("profiles")
    .update({ wechat_nickname: info.nickname, wechat_avatar_url: info.avatarUrl })
    .eq("wechat_openid", info.openId)
    .select("full_name");
  if (error) {
    console.error("[wechat] oauth: gravar perfil falhou:", error.message);
    return page("Error · 出错了", "Could not save. Try the link again.\n保存失败,请重新打开链接。", 500);
  }
  if (!data?.length) {
    return page(
      "Not linked · 未关联",
      "This WeChat is not linked to a SOT user yet. Link it in SOT → My profile first.\n此微信尚未关联 SOT 用户,请先在 SOT「My profile」绑定。"
    );
  }

  return page(
    "Done · 完成",
    `Your WeChat name and photo now show in SOT for ${escapeHtml(data[0].full_name)}. You can close this page.\n已在 SOT 显示你的微信昵称和头像,可以关闭此页面。`
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
