import { requireOwner } from "@/lib/dal";

import { AccessLabClient } from "./access-lab-client";

/**
 * PROTÓTIPO (não-produção) do novo modelo de acesso em 3 camadas
 * (Role → Company → User), com **Company como modificador de CRUD**.
 *
 * Tudo aqui roda em dados MOCK e LOCAIS — nenhuma migration, nenhuma escrita no
 * banco, nenhum vínculo com `role_features`/`user_features`. É uma tela de teste
 * pra mostrar ao cliente e iterar o desenho; quando a regra travar, isto vira a
 * base do `/access` de verdade. Descartável: apagar esta pasta remove tudo.
 *
 * Owner-only, como a tela real (`requireOwner`, não uma feature do catálogo — a
 * rota nem existe no catálogo de propósito).
 */
export default async function AccessLabPage() {
  await requireOwner();
  return <AccessLabClient />;
}
