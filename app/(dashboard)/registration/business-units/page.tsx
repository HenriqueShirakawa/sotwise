import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  externalIconUrl,
  isExternalIcon,
} from "@/domain/registration/business-unit-icon";

import { BusinessUnitsClient } from "./business-units-client";

const BUCKET = "business-units";

export default async function BusinessUnitsPage() {
  await requireFeature("registration");

  const admin = createAdminClient();
  const { data } = await admin
    .from("business_units")
    .select("id, name, icon_path")
    .is("deleted_at", null)
    .order("name");

  const rows = data ?? [];

  /** URLs assinadas (1h) só para os ícones que já estão no Storage — o bucket
   * não é público. Os legados do Bubble são servidos direto pelo CDN de lá. */
  const paths = rows
    .map((r) => r.icon_path)
    .filter((p): p is string => !!p && !isExternalIcon(p));
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data: urls } = await admin.storage.from(BUCKET).createSignedUrls(paths, 3600);
    for (const u of urls ?? []) {
      if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
    }
  }

  return (
    <BusinessUnitsClient
      data={rows.map((r) => ({
        id: r.id,
        name: r.name,
        icon_path: r.icon_path,
        icon_url: !r.icon_path
          ? null
          : isExternalIcon(r.icon_path)
            ? externalIconUrl(r.icon_path)
            : signed.get(r.icon_path) ?? null,
      }))}
    />
  );
}
