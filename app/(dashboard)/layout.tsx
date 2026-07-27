import { verifySession } from "@/lib/dal";
import { AppShell } from "@/components/app-shell/app-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Defesa em profundidade: além do proxy otimista, a DAL confirma sessão,
  // profile e status. Redireciona se ausente / blocked.
  const { profile, email, role, isAdmin } = await verifySession();

  return (
    <AppShell
      fullName={profile.full_name}
      email={email}
      role={role}
      isAdmin={isAdmin}
    >
      {children}
    </AppShell>
  );
}
