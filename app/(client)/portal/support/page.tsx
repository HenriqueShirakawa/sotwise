import type { Metadata } from "next";
import { MessageSquare } from "lucide-react";

import { requireClientScope } from "@/lib/dal";

export const metadata: Metadata = { title: "Support" };

/**
 * Suporte (chamados) é o bloco F do card do portal — ainda não construído. A
 * entrada no menu já existe para o desenho ficar completo; a tela avisa sem
 * fabricar dado.
 */
export default async function PortalSupportPage() {
  await requireClientScope();

  return (
    <div className="rounded-2xl border border-dashed bg-white px-6 py-16 text-center">
      <MessageSquare className="mx-auto size-8 text-slate-300" />
      <p className="mt-3 text-sm font-medium text-slate-700">Support is coming soon</p>
      <p className="mt-1 text-sm text-slate-500">
        In the meantime, reach out to your AGK contact as usual.
      </p>
    </div>
  );
}
