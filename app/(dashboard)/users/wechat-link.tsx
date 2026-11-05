"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

import { createWechatLinkQr, getWechatLinked, unlinkWechat } from "./wechat-actions";

const POLL_MS = 3_000;

/**
 * Bloco "WeChat" do Edit user. O vínculo é por QR (o OpenID não é digitável):
 * gera o QR, a pessoa escaneia com o WeChat dela (ou com a foto do QR, se o
 * admin mandar por mensagem) e a tela percebe sozinha quando vinculou.
 */
export function WechatLink({
  userId,
  initiallyLinked,
  enabled,
}: {
  userId: string;
  initiallyLinked: boolean;
  enabled: boolean;
}) {
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
      if (await getWechatLinked(userId)) {
        setQr(null);
        setLinked(true);
        toast.success("WeChat linked.");
        router.refresh();
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [qr, userId, router]);

  const generate = () =>
    startTransition(async () => {
      const res = await createWechatLinkQr(userId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setQr({ imageUrl: res.imageUrl, expiresAt: Date.now() + res.expiresInSeconds * 1000 });
    });

  const unlink = () =>
    startTransition(async () => {
      const res = await unlinkWechat(userId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setLinked(false);
      toast.success("WeChat unlinked.");
      router.refresh();
    });

  return (
    <div className="space-y-1.5">
      <Label>WeChat</Label>
      {!enabled ? (
        <p className="text-xs text-muted-foreground">WeChat is not configured yet.</p>
      ) : (
        <>
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
                Scan with WeChat (or send a picture of this code to the person). It follows the
                company account and links to this user. Valid for 10 minutes — this screen updates
                by itself.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              When linked, messages this user is tagged in also arrive in WeChat, and replies
              starting with the record number come back to SOT.
            </p>
          )}
        </>
      )}
    </div>
  );
}
