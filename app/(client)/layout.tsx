import { resolvePortalLocale } from "@/domain/client/locale";
import { requireClientScope } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";

import { ClientShell } from "./client-shell";

/**
 * Casca do app do cliente externo — deliberadamente NÃO é o `AppShell`.
 *
 * O shell interno carrega sidebar de features, caixa de mensagens e copilot;
 * nada disso pertence a quem é de fora, e reaproveitá-lo com tudo escondido
 * deixaria a superfície interna a um bug de renderização de distância. O portal
 * tem o próprio menu (Dashboard / My orders / Support), fixo no código e sem
 * nenhum link para tela interna.
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
  const [{ data: client }, locale] = await Promise.all([
    admin.from("clients").select("name").eq("id", clientId).single(),
    resolvePortalLocale(),
  ]);

  return (
    <ClientShell
      fullName={session.profile.full_name}
      clientName={client?.name ?? null}
      locale={locale}
    >
      {children}
    </ClientShell>
  );
}
