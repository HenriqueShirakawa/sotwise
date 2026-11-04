"use client";

import { createContext, useContext } from "react";

import { portalMessages, type PortalLocale, type PortalMessages } from "@/lib/portal-i18n";

/**
 * Idioma do portal para os componentes de cliente. O valor vem do servidor
 * (layout → `resolvePortalLocale`); aqui só se distribui o dicionário.
 */
const PortalI18nContext = createContext<{ locale: PortalLocale; t: PortalMessages }>({
  locale: "en",
  t: portalMessages("en"),
});

export function PortalI18nProvider({
  locale,
  children,
}: {
  locale: PortalLocale;
  children: React.ReactNode;
}) {
  return (
    <PortalI18nContext.Provider value={{ locale, t: portalMessages(locale) }}>
      {children}
    </PortalI18nContext.Provider>
  );
}

export function usePortalI18n() {
  return useContext(PortalI18nContext);
}
