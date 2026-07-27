import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Encerra a sessão (limpa cookies) e volta para /login. Usado pelo botão
 * "Sign out" (POST) e pelo redirect da DAL quando o usuário está `blocked` (GET).
 */
async function handle(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const reason = new URL(request.url).searchParams.get("reason");
  redirect(reason ? `/login?error=${encodeURIComponent(reason)}` : "/login");
}

export const GET = handle;
export const POST = handle;
