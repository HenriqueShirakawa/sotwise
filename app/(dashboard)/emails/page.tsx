import { notFound } from "next/navigation";

// E-mail por etapa saiu de produção (time do cliente foi ativado); rota
// desligada incondicionalmente porque owner sempre passa por requireFeature,
// então só um guard direto garante que a tela não existe mais. Implementação
// completa (requireFeature("email_history") + loadEmailRecords + EmailsClient)
// segue funcionando normalmente na branch dev.
export const metadata = { title: "Emails" };

export default async function EmailsPage() {
  notFound();
}
