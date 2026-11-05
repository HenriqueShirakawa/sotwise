"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { createMyWechatQr, isMyWechatLinked, unlinkMyWechat } from "./wechat-actions";

const POLL_MS = 3_000;

/**
 * Card "WeChat" do My profile. Gera o QR do próprio usuário; a pessoa escaneia
 * com o WeChat do celular e a tela percebe sozinha quando vinculou.
 */
export function WechatCard({ initiallyLinked, enabled }: { initiallyLinked: boolean; enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [linked, setLinked] = useState(initiallyLinked);
  const [qr, setQr] = useState<{ imageUrl: string; expiresAt: number } | null>(null);

  // Enquanto o QR está na tela, pergunta se já vinculou; para quando vence.
  useEffect(() => {
    if (!qr) return;
    const timer = setInterval(async () => {
      if (Date.now() > qr.expiresAt) {
        setQr(null);
        return;
      }
      if (await isMyWechatLinked()) {
        setQr(null);
        setLinked(true);
        toast.success("WeChat linked.");
        router.refresh();
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [qr, router]);

  const generate = () =>
    startTransition(async () => {
      const res = await createMyWechatQr();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setQr({ imageUrl: res.imageUrl, expiresAt: Date.now() + res.expiresInSeconds * 1000 });
    });

  const unlink = () =>
    startTransition(async () => {
      const res = await unlinkMyWechat();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setLinked(false);
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
            <div className="flex flex-wrap items-center gap-2">
              <span className={linked ? "text-sm text-emerald-700" : "text-sm text-muted-foreground"}>
                {linked ? "Linked" : "Not linked"}
              </span>
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
                  screen updates by itself.
                </p>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
