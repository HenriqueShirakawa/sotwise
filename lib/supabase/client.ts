import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/types/database";

/**
 * Client do browser (chave `anon`). Usado SOMENTE para o Supabase Auth
 * (signIn, resetPassword, updateUser, sessão). Como o RLS está em deny-all,
 * ele não lê nenhuma tabela — todo acesso a dados é server-side via admin client.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
