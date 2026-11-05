"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

import { unlinkWechat } from "./wechat-actions";

/**
 * Bloco "WeChat" do Edit user: só mostra o status e deixa o admin desvincular.
 * O vínculo é da própria pessoa, em My profile (cada um escaneia o seu QR com o
 * seu celular) — assim o admin não prende o WeChat dele no usuário de outro.
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
            {linked ? (
              <Button type="button" variant="ghost" size="sm" onClick={unlink} disabled={pending}>
                Unlink
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Each person links their own WeChat in My profile.
          </p>
        </>
      )}
    </div>
  );
}
