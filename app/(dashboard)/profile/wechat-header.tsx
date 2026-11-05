"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { getMyWechat, sendMyWechatInfoLink, unlinkMyWechat } from "./wechat-actions";

const POLL_MS = 3_000;
/** Depois do vínculo o robô manda o link de nome/foto; a tela espera por ele até 10 min. */
const WATCH_MS = 10 * 60_000;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "");
  return letters.toUpperCase() || "?";
}

/**
 * Topo do My profile quando o WeChat está vinculado — cabeçalho de perfil como
 * em qualquer app: foto do WeChat, nome, identificação e o selo verde
 * "Connected". Sem vínculo, quem aparece é o card de vincular (wechat-card).
 */
export function WechatProfileHeader({
  fullName,
  email,
  role,
  company,
  nickname: initialNickname,
  avatarUrl: initialAvatar,
}: {
  fullName: string;
  email: string;
  role: string;
  company: string;
  nickname: string | null;
  avatarUrl: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [nickname, setNickname] = useState(initialNickname);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatar);
  const [watchUntil, setWatchUntil] = useState<number | null>(() =>
    initialNickname ? null : Date.now() + WATCH_MS
  );

  // Sem nome ainda: pergunta de tempos em tempos se a pessoa já tocou em "Permitir".
  useEffect(() => {
    if (!watchUntil) return;
    const timer = setInterval(async () => {
      if (Date.now() > watchUntil) {
        setWatchUntil(null);
        return;
      }
      const next = await getMyWechat();
      if (!next.ref) {
        setWatchUntil(null);
        router.refresh(); // desvinculou por outro caminho
        return;
      }
      if (next.nickname) {
        setNickname(next.nickname);
        setAvatarUrl(next.avatarUrl);
        setWatchUntil(null);
        toast.success("WeChat name and photo added.");
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [watchUntil, router]);

  const sendInfoLink = () =>
    startTransition(async () => {
      const res = await sendMyWechatInfoLink();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Link sent — open it in WeChat and tap Allow.");
      setWatchUntil(Date.now() + WATCH_MS);
    });

  const unlink = () =>
    startTransition(async () => {
      const res = await unlinkMyWechat();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("WeChat unlinked.");
      router.refresh();
    });

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 pt-6 text-center sm:flex-row sm:items-center sm:text-left">
        {avatarUrl ? (
          // Foto servida pelo WeChat (qlogo) — sem otimização e sem referrer.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="size-20 shrink-0 rounded-full border object-cover"
          />
        ) : (
          <div className="flex size-20 shrink-0 items-center justify-center rounded-full bg-primary/10 text-2xl font-semibold text-primary">
            {initials(fullName)}
          </div>
        )}

        <div className="grid min-w-0 flex-1 gap-1">
          <span className="truncate text-lg font-semibold">{fullName}</span>
          <span className="truncate text-sm text-muted-foreground">{email}</span>
          <span className="text-xs text-muted-foreground">
            <span className="capitalize">{role}</span> · {company}
            {nickname ? <> · WeChat: {nickname}</> : null}
          </span>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1 sm:justify-start">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Connected
            </span>
            {!nickname ? (
              <button
                type="button"
                onClick={sendInfoLink}
                disabled={pending}
                className="text-xs text-primary underline-offset-2 hover:underline disabled:opacity-50"
              >
                Get my WeChat name and photo
              </button>
            ) : null}
          </div>
        </div>

        <Button type="button" variant="ghost" size="sm" onClick={unlink} disabled={pending}>
          Unlink
        </Button>
      </CardContent>
    </Card>
  );
}
