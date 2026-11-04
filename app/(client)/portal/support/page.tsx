import type { Metadata } from "next";
import { MessageSquare } from "lucide-react";

import { resolvePortalLocale } from "@/domain/client/locale";
import { requireClientScope } from "@/lib/dal";
import { portalMessages } from "@/lib/portal-i18n";

export async function generateMetadata(): Promise<Metadata> {
  return { title: portalMessages(await resolvePortalLocale()).nav.support };
}

/**
 * Suporte (chamados) é o bloco F do card do portal — ainda não construído. A
 * entrada no menu já existe para o desenho ficar completo; a tela avisa sem
 * fabricar dado.
 */
export default async function PortalSupportPage() {
  await requireClientScope();
  const t = portalMessages(await resolvePortalLocale());

  return (
    <div className="rounded-2xl border border-dashed bg-white px-6 py-16 text-center">
      <MessageSquare className="mx-auto size-8 text-slate-300" />
      <p className="mt-3 text-sm font-medium text-slate-700">{t.support.comingSoon}</p>
      <p className="mt-1 text-sm text-slate-500">{t.support.text}</p>
    </div>
  );
}
