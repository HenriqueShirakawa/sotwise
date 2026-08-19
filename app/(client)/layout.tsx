import { requireClientScope } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { SotwiseLogo } from "@/components/brand/sotwise-logo";

import { ClientUserMenu } from "./client-user-menu";

/**
 * Casca do app do cliente externo — deliberadamente NÃO é o `AppShell`.
 *
 * O shell interno carrega sidebar de features, caixa de mensagens e copilot;
 * nada disso pertence a quem é de fora, e reaproveitá-lo com tudo escondido
 * deixaria a superfície interna a um bug de renderização de distância. Aqui é
 * topo com logo, nome do cliente e menu de conta. Só.
 *
 * A guarda vive na page também: layout não é fronteira de segurança no App
 * Router (Partial Rendering não re-executa layout a cada navegação), e é por
 * isso que `requireClientScope()` roda nos dois lugares.
 */
export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, clientId } = await requireClientScope();

  const admin = createAdminClient();
  const { data: client } = await admin
    .from("clients")
    .select("name")
    .eq("id", clientId)
    .single();

  return (
    <div className="flex min-h-full flex-1 flex-col bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <SotwiseLogo className="h-8 shrink-0" />
            {client?.name ? (
              <>
                <span aria-hidden className="h-6 w-px shrink-0 bg-slate-200" />
                <span className="truncate text-sm font-medium text-slate-600">
                  {client.name}
                </span>
              </>
            ) : null}
          </div>
          <ClientUserMenu fullName={session.profile.full_name} email={session.email} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
