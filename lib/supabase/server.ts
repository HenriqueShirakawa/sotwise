import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/types/database";

/**
 * Client de servidor ligado aos cookies da request (chave `anon`).
 * Serve para ler/validar a sessão (`auth.getUser()`), nunca para dados
 * (RLS deny-all bloqueia). No Next 16 `cookies()` é assíncrono.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Chamado de um Server Component: ignorável — o proxy.ts renova a sessão.
          }
        },
      },
    }
  );
}
