"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { createMyWechatQr, getMyWechat, sendMyWechatInfoLink, unlinkMyWechat } from "./wechat-actions";

const POLL_MS = 3_000;
/** Quanto tempo a tela espera o celular (QR vale 10 min; o link de nome/foto também). */
const WATCH_MS = 10 * 60_000;

/** `ref` = impressão do OpenID (null = não vinculado); muda quando outro WeChat vincula. */
type WechatState = { ref: string | null; nickname: string | null; avatarUrl: string | null };

/**
 * Card "WeChat" do My profile. Gera o QR do próprio usuário; a pessoa escaneia
 * com o WeChat do celular e a tela percebe sozinha quando vinculou. Depois o
 * robô manda um link para ela autorizar nome e foto — a tela também percebe.
 */
export function WechatCard({ initial, enabled }: { initial: WechatState; enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState(initial);
  /** QR na tela + o `ref` de antes dele (para perceber o vínculo NOVO). */
  const [qr, setQr] = useState<{ imageUrl: string; before: string | null } | null>(null);
  /** Enquanto != null, pergunta ao servidor se o celular já fez a parte dele. */
  const [watchUntil, setWatchUntil] = useState<number | null>(null);
  const linked = !!state.ref;
  const hadNickname = !!state.nickname;

  useEffect(() => {
    if (!watchUntil) return;
    const timer = setInterval(async () => {
      if (Date.now() > watchUntil) {
        setWatchUntil(null);
        setQr(null);
        return;
      }
      const next = await getMyWechat();
      const newlyLinked = !!qr && !!next.ref && next.ref !== qr.before;
      if (qr && !newlyLinked) return; // ainda esperando o QR: a tela fica como está
      if (newlyLinked) {
        setQr(null);
        toast.success("WeChat linked.");
      }
      if (next.nickname && !hadNickname) toast.success("WeChat name and photo added.");
      setState(next);
      if (next.ref && next.nickname) {
        setWatchUntil(null);
        router.refresh();
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [watchUntil, qr, hadNickname, router]);

  const generate = () =>
    startTransition(async () => {
      const res = await createMyWechatQr();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setQr({ imageUrl: res.imageUrl, before: state.ref });
      setWatchUntil(Date.now() + Math.min(res.expiresInSeconds * 1000, WATCH_MS));
    });

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
      setState({ ref: null, nickname: null, avatarUrl: null });
      setWatchUntil(null);
      toast.success("WeChat unlinked.");
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>WeChat</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {!enabled ? (
          <p className="text-sm text-muted-foreground">WeChat is not configured yet.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Messages you are tagged in also arrive in your WeChat, and replies starting with the
              record number (&quot;1676 …&quot;, &quot;PL 1473 …&quot;, &quot;SH 1473 …&quot;) come
              back to SOT as yours.
            </p>

            {linked ? (
              <div className="flex items-center gap-3 rounded-lg border p-3">
                {state.avatarUrl ? (
                  // Foto servida pelo WeChat (qlogo) — sem otimização e sem referrer.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={state.avatarUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="size-10 shrink-0 rounded-full border object-cover"
                  />
                ) : (
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full border bg-muted text-xs text-muted-foreground">
                    WeChat
                  </div>
                )}
                <div className="grid gap-0.5">
                  <span className="text-sm font-medium text-emerald-700">
                    Linked{state.nickname ? ` as ${state.nickname}` : ""}
                  </span>
                  {!state.nickname ? (
                    <span className="text-xs text-muted-foreground">
                      Name and photo not shared yet.{" "}
                      <button
                        type="button"
                        onClick={sendInfoLink}
                        disabled={pending}
                        className="text-primary underline-offset-2 hover:underline disabled:opacity-50"
                      >
                        Send me the link in WeChat
                      </button>
                    </span>
                  ) : null}
                </div>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Not linked</span>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={generate} disabled={pending}>
                {pending && !qr ? <Loader2 className="animate-spin" /> : null}
                {linked ? "Link another WeChat" : "Link WeChat"}
              </Button>
              {linked ? (
                <Button type="button" variant="ghost" size="sm" onClick={unlink} disabled={pending}>
                  Unlink
                </Button>
              ) : null}
            </div>

            {qr ? (
              <div className="flex items-start gap-3 rounded-lg border p-3">
                {/* Imagem servida pelo próprio WeChat (showqrcode) — sem otimização. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr.imageUrl} alt="WeChat link QR code" className="size-36 shrink-0" />
                <p className="text-xs text-muted-foreground">
                  Scan with WeChat on your phone and follow the account. Valid for 10 minutes — this
                  screen updates by itself. Then open the link the account sends you and tap Allow
                  to show your WeChat name and photo here.
                </p>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
