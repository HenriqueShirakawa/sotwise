"use client";

import { Mail } from "lucide-react";

import { SupportChat } from "@/components/support/support-chat";
import type { SupportMessage, SupportRepresentative } from "@/domain/support/chat";

import { usePortalI18n } from "../../portal-i18n-provider";
import { markPortalSupportRead, sendPortalSupportMessage } from "./actions";

/** Mesmo limite do banco (`support_messages.body`), espelhado aqui para o contador. */
const MAX_LENGTH = 2000;

const INTL_LOCALE = { en: "en-GB", "pt-BR": "pt-BR", es: "es", zh: "zh-CN" } as const;

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function SupportClient({
  viewerId,
  representatives,
  messages,
}: {
  viewerId: string;
  representatives: SupportRepresentative[];
  messages: SupportMessage[];
}) {
  const { t, locale } = usePortalI18n();
  const ts = t.support;

  return (
    <div className="grid gap-5 animate-in fade-in slide-in-from-bottom-1 duration-300 lg:grid-cols-[300px_1fr]">
      <section className="h-fit rounded-2xl border bg-white">
        <div className="border-b px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">{ts.contactsTitle}</h2>
          <p className="mt-0.5 text-xs text-slate-500">{ts.contactsText}</p>
        </div>
        {representatives.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-500">{ts.noContacts}</p>
        ) : (
          <ul className="divide-y">
            {representatives.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                  {initials(r.name)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{r.name}</p>
                  <p className="text-xs text-slate-400">
                    {r.company === "China" ? ts.teamChina : ts.teamBR}
                  </p>
                  {r.email ? (
                    <a
                      href={`mailto:${r.email}`}
                      className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-xs text-primary hover:underline"
                    >
                      <Mail className="size-3 shrink-0" />
                      <span className="truncate">{r.email}</span>
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex h-[calc(100dvh-11rem)] min-h-[420px] flex-col overflow-hidden rounded-2xl border bg-white">
        <div className="border-b px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">{ts.chatTitle}</h2>
        </div>
        <SupportChat
          className="flex-1"
          messages={messages}
          viewerId={viewerId}
          locale={INTL_LOCALE[locale]}
          maxLength={MAX_LENGTH}
          labels={ts}
          onSend={sendPortalSupportMessage}
          onRead={markPortalSupportRead}
        />
      </section>
    </div>
  );
}
