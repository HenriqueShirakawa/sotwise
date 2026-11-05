"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { createMyWechatQr, getMyWechat } from "./wechat-actions";

const POLL_MS = 3_000;

/**
 * Card "WeChat" do My profile para quem AINDA NÃO vinculou: gera o QR do
 * próprio usuário, a pessoa escaneia com o celular e a tela percebe sozinha.
 * Vinculou → refresh, e o topo da página vira o cabeçalho (wechat-header).
 */
export function WechatCard({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [qr, setQr] = useState<{ imageUrl: string; expiresAt: number } | null>(null);

  useEffect(() => {
    if (!qr) return;
    const timer = setInterval(async () => {
      if (Date.now() > qr.expiresAt) {
        setQr(null);
        return;
      }
      if ((await getMyWechat()).ref) {
        setQr(null);
        toast.success("WeChat connected.");
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
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Not connected</span>
              <Button type="button" variant="outline" size="sm" onClick={generate} disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : null}
                Link WeChat
              </Button>
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
