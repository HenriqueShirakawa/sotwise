import { verifySession } from "@/lib/dal";
import { countUnreadMessages } from "@/lib/messages";
import { AppShell } from "@/components/app-shell/app-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Defesa em profundidade: além do proxy otimista, a DAL confirma sessão,
  // profile e status. Redireciona se ausente / blocked.
  const { profile, email, role, permissions, userId } = await verifySession();
  const unreadMessages = await countUnreadMessages(userId);

  return (
    <AppShell
      fullName={profile.full_name}
      email={email}
      role={role}
      permissions={permissions}
      unreadMessages={unreadMessages}
    >
      {children}
    </AppShell>
  );
}
