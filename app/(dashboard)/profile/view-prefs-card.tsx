"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { saveViewPrefs } from "@/lib/view-prefs-actions";
import { VIEW_PREF_KEYS, VIEW_PREF_LABELS, type ViewPrefs } from "@/lib/view-prefs";

/**
 * Preferências de visualização do checklist. Cada toggle salva na hora (sem
 * botão de Save): é preferência pessoal e reversível, não um formulário.
 *
 * Nada aqui restringe ninguém — só muda o que ESTE usuário vê nas telas de
 * Order, Pre-loading e Shipment.
 */
export function ViewPrefsCard({ initial }: { initial: ViewPrefs }) {
  const router = useRouter();
  const [prefs, setPrefs] = useState(initial);
  const [pending, startTransition] = useTransition();

  function toggle(key: keyof ViewPrefs, value: boolean) {
    const previous = prefs;
    const next = { ...prefs, [key]: value };
    setPrefs(next);

    startTransition(async () => {
      const res = await saveViewPrefs(next);
      if (!res.ok) {
        setPrefs(previous);
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Checklist view</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1">
        <p className="pb-2 text-sm text-muted-foreground">
          Changes what you see on Order, Pre-loading and Shipment checklists. It does
          not change what you can do.
        </p>
        {VIEW_PREF_KEYS.map((key) => (
          <div
            key={key}
            className="flex items-center justify-between gap-4 border-b py-3 last:border-b-0"
          >
            <div className="grid gap-0.5">
              <span className="text-sm font-medium">{VIEW_PREF_LABELS[key].title}</span>
              <span className="text-xs text-muted-foreground">
                {VIEW_PREF_LABELS[key].hint}
              </span>
            </div>
            <Switch
              checked={prefs[key]}
              onCheckedChange={(v) => toggle(key, v)}
              disabled={pending}
              aria-label={VIEW_PREF_LABELS[key].title}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
