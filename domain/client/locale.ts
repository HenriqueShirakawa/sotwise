import "server-only";

import { cache } from "react";

import { requireClientScope } from "@/lib/dal";
import { isPortalLocale, type PortalLocale } from "@/lib/portal-i18n";
import { createAdminClient } from "@/lib/supabase/admin";

/** Chave da escolha de idioma do portal em `profiles.ui_preferences`. */
export const PORTAL_LOCALE_PREF = "portal_locale";

/**
 * Idioma do portal para o usuário logado:
 *  1. o que ele escolheu no seletor (`ui_preferences.portal_locale`);
 *  2. senão, o idioma do cliente — a MESMA regra dos e-mails
 *     (`clients.language` → `country_language_defaults` pelo país);
 *  3. senão, inglês.
 *
 * `cache()` porque layout e page pedem o mesmo valor no mesmo request.
 */
export const resolvePortalLocale = cache(async (): Promise<PortalLocale> => {
  const { session, clientId } = await requireClientScope();

  const pref = (session.profile.ui_preferences ?? {})[PORTAL_LOCALE_PREF];
  if (isPortalLocale(pref)) return pref;

  const admin = createAdminClient();
  const { data: client } = await admin
    .from("clients")
    .select("language, country_id")
    .eq("id", clientId)
    .single();
  if (isPortalLocale(client?.language)) return client.language;

  if (client?.country_id) {
    const { data: byCountry } = await admin
      .from("country_language_defaults")
      .select("language")
      .eq("country_id", client.country_id)
      .maybeSingle();
    if (isPortalLocale(byCountry?.language)) return byCountry.language;
  }

  return "en";
});
