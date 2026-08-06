import { verifySession } from "@/lib/dal";
import { PageHeader } from "@/components/page-header";

import { ProfileForm } from "./profile-form";

export default async function ProfilePage() {
  const { profile, email, role } = await verifySession();

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="My profile" />
      <ProfileForm
        fullName={profile.full_name}
        dateOfBirth={profile.date_of_birth}
        email={email ?? ""}
        role={role}
        company={profile.company}
      />
    </div>
  );
}
