import { requireAdmin } from "@/lib/dal";
import { ComingSoon } from "@/components/page-header";

export default async function UsersPage() {
  await requireAdmin(); // não-admin → volta para /orders
  return <ComingSoon title="Users" />;
}
