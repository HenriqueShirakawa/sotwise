import { requireInternal } from "@/lib/dal";
import { PageHeader } from "@/components/page-header";
import { readViewPrefs } from "@/lib/view-prefs";
import { wechatConfig } from "@/lib/wechat/client";

import { ProfileForm } from "./profile-form";
import { ViewPrefsCard } from "./view-prefs-card";
import { WechatCard } from "./wechat-card";
import { WechatProfileHeader } from "./wechat-header";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const { profile, email, role } = await requireInternal();
  const wechatEnabled = !!wechatConfig();
  // WeChat vinculado = cabeçalho de perfil no topo; sem vínculo = card de vincular.
  const wechatLinked = wechatEnabled && !!profile.wechat_openid;

  return (
    <div className="mx-auto grid max-w-xl gap-6">
      <PageHeader title="My profile" />
      {wechatLinked ? (
        <WechatProfileHeader
          fullName={profile.full_name}
          email={email ?? ""}
          role={role}
          company={profile.company}
          nickname={profile.wechat_nickname}
          avatarUrl={profile.wechat_avatar_url}
        />
      ) : null}
      <ProfileForm
        fullName={profile.full_name}
        dateOfBirth={profile.date_of_birth}
        email={email ?? ""}
        role={role}
        company={profile.company}
      />
      {wechatLinked ? null : <WechatCard enabled={wechatEnabled} />}
      <ViewPrefsCard initial={readViewPrefs(profile.ui_preferences)} />
    </div>
  );
}
