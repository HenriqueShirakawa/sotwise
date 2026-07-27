import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Callback do Supabase Auth (PKCE): troca o `?code=` por uma sessão.
 * Usado pelo link de reset de senha (redireciona para /update-password) e por
 * eventuais magic links. A URL de redirect precisa estar liberada no dashboard
 * do Supabase (Authentication → URL Configuration).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/orders";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin));
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth", url.origin));
}
