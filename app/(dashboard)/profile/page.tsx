import { verifySession } from "@/lib/dal";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

export default async function ProfilePage() {
  const { profile, email, role } = await verifySession();

  // Edição (full_name / date_of_birth) entra numa fase seguinte — aqui só leitura.
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="My profile" />
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label>Full name</Label>
            <Input value={profile.full_name} readOnly />
          </div>
          <div className="grid gap-2">
            <Label>Email</Label>
            <Input value={email ?? ""} readOnly />
          </div>
          <div className="grid gap-2">
            <Label>Role</Label>
            <Input value={role} readOnly className="capitalize" />
          </div>
          <div className="grid gap-2">
            <Label>Company</Label>
            <Input value={profile.company} readOnly />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
