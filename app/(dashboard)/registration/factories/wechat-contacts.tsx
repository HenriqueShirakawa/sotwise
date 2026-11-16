"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Copy, Loader2, Unlink } from "lucide-react";
import { toast } from "sonner";

import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";

import { createFactoryInvite, getFactoryWechat, unlinkFactoryContact } from "./wechat-actions";

type State = Awaited<ReturnType<typeof getFactoryWechat>>;
type Invite = { code: string; expiresAt: string; qrDataUrl: string | null };

const POLL_MS = 4_000;

/**
 * Painel "WeChat" da fábrica (drawer da lista de Factories): contatos do
 * fornecedor vinculados + convite para vincular mais um. Enquanto há convite
 * na tela, pergunta de tempos em tempos se alguém já usou (a lista atualiza
 * sozinha, como o QR do My profile).
 */
export function FactoryWechatContacts({ factoryId, canEdit }: { factoryId: string; canEdit: boolean }) {
  const [state, setState] = useState<State | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    const next = await getFactoryWechat(factoryId);
    setState(next);
    return next;
  }, [factoryId]);

  useEffect(() => {
    let alive = true;
    getFactoryWechat(factoryId).then((next) => {
      if (alive) setState(next);
    });
    return () => {
      alive = false;
    };
  }, [factoryId]);

  useEffect(() => {
    if (!invite) return;
    const before = state?.contacts.length ?? 0;
    const timer = setInterval(async () => {
      const next = await load();
      if (next.contacts.length > before) {
        toast.success("Supplier contact linked.");
        setInvite(null);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
    // Só reinicia quando o convite muda — `state` muda a cada consulta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invite, load]);

  const generate = () =>
    startTransition(async () => {
      const res = await createFactoryInvite(factoryId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setInvite({ code: res.code, expiresAt: res.expiresAt, qrDataUrl: res.qrDataUrl });
      if (res.qrError) toast.message("QR code unavailable — share the invite code instead.");
    });

  const unlink = (contactId: string, name: string) =>
    startTransition(async () => {
      const res = await unlinkFactoryContact(contactId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${name} unlinked.`);
      await load();
    });

  if (!state) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }

  const shown = invite ?? (state.invite ? { code: state.invite.code, expiresAt: state.invite.expires_at, qrDataUrl: null } : null);

  return (
    <div className="grid gap-4 pt-2">
      <p className="text-sm text-muted-foreground">
        Supplier contacts answer the ETD, delays and Ready parts of this factory&apos;s lines in the
        SOT Mini Program on WeChat.
      </p>

      <div className="grid gap-2">
        <h3 className="text-sm font-medium">Linked contacts</h3>
        {state.contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No WeChat contact linked yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {state.contacts.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="text-xs text-muted-foreground">Linked {formatDate(c.linked_at)}</span>
                </div>
                {canEdit ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Unlink ${c.name}`}
                    disabled={pending}
                    onClick={() => unlink(c.id, c.name)}
                  >
                    <Unlink />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {!state.enabled ? (
        <p className="text-sm text-muted-foreground">The WeChat Mini Program is not configured yet.</p>
      ) : canEdit ? (
        <div className="grid gap-3">
          <Button type="button" variant="outline" onClick={generate} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            {shown ? "New invite" : "Invite a contact"}
          </Button>
          {shown ? (
            <div className="grid gap-3 rounded-lg border p-3">
              {shown.qrDataUrl ? (
                // Imagem gerada pelo WeChat (data URL) — sem otimização.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shown.qrDataUrl} alt="Mini Program invite QR code" className="size-40 justify-self-center" />
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="block text-xs text-muted-foreground">Invite code</span>
                  <span className="font-mono text-lg tracking-widest">{shown.code}</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Copy invite code"
                  onClick={() => {
                    void navigator.clipboard.writeText(shown.code);
                    toast.success("Invite code copied.");
                  }}
                >
                  <Copy />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {shown.qrDataUrl
                  ? "The supplier scans the QR with WeChat, or opens the SOT Mini Program and types the code."
                  : "Send this code to the supplier: they open the SOT Mini Program on WeChat and type it."}{" "}
                Single use, valid until {formatDate(shown.expiresAt)}.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
