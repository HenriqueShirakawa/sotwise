import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

/**
 * Callback do Supabase Auth. Trata os dois formatos de link:
 *  - PKCE: `?code=...` → exchangeCodeForSession
 *  - Token hash (recovery/magic link): `?token_hash=...&type=...` → verifyOtp
 * Usado pelo convite e pelo reset de senha (ambos caem em /update-password).
 * Os dois links são montados pelo app com `token_hash`, então NÃO dependem do
 * Site URL / Redirect URLs do painel do Supabase.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next") ?? "/orders";
  const providerError =
    url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (providerError) {
    return NextResponse.redirect(new URL("/login?error=auth", url.origin));
  }

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }

  return NextResponse.redirect(new URL("/login?error=auth", url.origin));
}
