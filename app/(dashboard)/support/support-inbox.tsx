"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, LifeBuoy, Search } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { SupportChat } from "@/components/support/support-chat";
import { Input } from "@/components/ui/input";
import type {
  SupportConversation,
  SupportMessage,
  SupportRepresentative,
} from "@/domain/support/chat";
import { cn } from "@/lib/utils";

import { markInternalSupportRead, sendInternalSupportMessage } from "./actions";

const MAX_LENGTH = 2000;

type Filter = "mine" | "all";

function shortWhen(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat("en-GB", sameDay
    ? { hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "2-digit" }
  ).format(d);
}

export function SupportInbox({
  viewerId,
  conversations,
  selected,
  messages,
  representatives,
  canReply,
}: {
  viewerId: string;
  conversations: SupportConversation[];
  selected: { id: string; name: string } | null;
  messages: SupportMessage[];
  representatives: SupportRepresentative[];
  canReply: boolean;
}) {
  // Quem representa algum cliente começa em "Mine"; quem não representa
  // ninguém (admin olhando tudo) começa em "All".
  const hasMine = conversations.some((c) => c.mine);
  const [filter, setFilter] = useState<Filter>(hasMine ? "mine" : "all");
  const [q, setQ] = useState("");

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return conversations.filter(
      (c) =>
        (filter === "all" || c.mine) &&
        (!term || c.clientName.toLowerCase().includes(term))
    );
  }, [conversations, filter, q]);

  const unreadMine = conversations.filter((c) => c.mine).reduce((n, c) => n + c.unread, 0);
  const unreadAll = conversations.reduce((n, c) => n + c.unread, 0);

  return (
    <div>
      <PageHeader
        title="Support"
        description="Chat with clients from the portal. Each client has one conversation with its representatives."
      />

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* Lista — no celular some quando há conversa aberta. */}
        <section
          className={cn(
            "flex min-h-0 flex-col overflow-hidden rounded-xl border bg-white lg:h-[calc(100dvh-12rem)]",
            selected && "hidden lg:flex"
          )}
        >
          <div className="space-y-3 border-b p-3">
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
              {(
                [
                  ["mine", "My clients", unreadMine],
                  ["all", "All", unreadAll],
                ] as const
              ).map(([id, label, unread]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    filter === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                  )}
                >
                  {label}
                  {unread > 0 ? (
                    <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">
                      {unread}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Client"
                className="h-9 bg-white pl-9"
              />
            </div>
          </div>

          <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
            {visible.length === 0 ? (
              <li className="px-4 py-10 text-center text-sm text-muted-foreground">
                {filter === "mine"
                  ? "You don't represent any client yet. Representatives are set in Registration → Clients."
                  : "No conversations yet."}
              </li>
            ) : (
              visible.map((c) => (
                <li key={c.clientId}>
                  <Link
                    href={`/support?client=${c.clientId}`}
                    scroll={false}
                    className={cn(
                      "block px-4 py-3 transition-colors hover:bg-slate-50",
                      selected?.id === c.clientId && "bg-accent/60 hover:bg-accent/60"
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={cn(
                          "truncate text-sm text-slate-800",
                          c.unread > 0 && "font-semibold"
                        )}
                      >
                        {c.clientName}
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-400" suppressHydrationWarning>
                        {shortWhen(c.lastAt)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-slate-500">
                        {c.lastMessage
                          ? `${c.lastFromClient ? "" : "AGK: "}${c.lastMessage}`
                          : "No messages yet"}
                      </span>
                      {c.unread > 0 ? (
                        <span className="shrink-0 rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground">
                          {c.unread}
                        </span>
                      ) : null}
                    </div>
                  </Link>
                </li>
              ))
            )}
          </ul>
        </section>

        <section
          className={cn(
            "flex h-[calc(100dvh-12rem)] min-h-[420px] flex-col overflow-hidden rounded-xl border bg-white",
            !selected && "hidden lg:flex"
          )}
        >
          {selected ? (
            <>
              <div className="flex items-start gap-3 border-b px-5 py-3.5">
                <Link
                  href="/support"
                  className="mt-0.5 text-slate-400 hover:text-slate-700 lg:hidden"
                  aria-label="Back to conversations"
                >
                  <ArrowLeft className="size-5" />
                </Link>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-slate-900">{selected.name}</h2>
                  <p className="truncate text-xs text-slate-500">
                    {representatives.length
                      ? `Representatives: ${representatives.map((r) => r.name).join(", ")}`
                      : "No representatives — set them in Registration → Clients."}
                  </p>
                </div>
              </div>
              <SupportChat
                key={selected.id}
                className="flex-1"
                messages={messages}
                viewerId={viewerId}
                locale="en-GB"
                maxLength={MAX_LENGTH}
                readOnly={!canReply}
                tagOf={(m) => (m.fromClient ? "Client" : null)}
                labels={{
                  empty: "No messages yet. Write below to start the conversation with this client.",
                  placeholder: "Write a reply…",
                  send: "Send",
                  you: "You",
                  sendError: "Couldn't send the message.",
                  tooLong: (max) => `Up to ${max} characters.`,
                }}
                onSend={(body) => sendInternalSupportMessage(selected.id, body)}
                onRead={() => markInternalSupportRead(selected.id)}
              />
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <LifeBuoy className="size-8 text-slate-300" />
              <p className="text-sm text-muted-foreground">Pick a conversation on the left.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
