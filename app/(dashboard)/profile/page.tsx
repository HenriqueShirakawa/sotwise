import { requireInternal } from "@/lib/dal";
import { PageHeader } from "@/components/page-header";
import { readViewPrefs } from "@/lib/view-prefs";
import { wechatConfig } from "@/lib/wechat/client";
import { wechatRef } from "@/lib/wechat/profile-info";

import { ProfileForm } from "./profile-form";
import { ViewPrefsCard } from "./view-prefs-card";
import { WechatCard } from "./wechat-card";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const { profile, email, role } = await requireInternal();

  return (
    <div className="mx-auto grid max-w-xl gap-6">
      <PageHeader title="My profile" />
      <ProfileForm
        fullName={profile.full_name}
        dateOfBirth={profile.date_of_birth}
        email={email ?? ""}
        role={role}
        company={profile.company}
      />
      <WechatCard
        initial={{
          ref: wechatRef(profile.wechat_openid),
          nickname: profile.wechat_nickname,
          avatarUrl: profile.wechat_avatar_url,
        }}
        enabled={!!wechatConfig()}
      />
      <ViewPrefsCard initial={readViewPrefs(profile.ui_preferences)} />
    </div>
  );
}
