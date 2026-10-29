import { TablePageSkeleton } from "@/components/app-shell/table-page-skeleton";

/**
 * Esqueleto padrão de qualquer tela do painel sem `loading.tsx` próprio (To do,
 * Users, Registration, E-mails, Access...): ao clicar, a tela troca na hora e
 * os dados chegam depois — preferência do usuário (29/10/2026).
 */
export default function Loading() {
  return <TablePageSkeleton columns={6} />;
}
