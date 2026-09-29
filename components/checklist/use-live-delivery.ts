"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { DELIVERY_ISSUE_LABEL } from "@/components/checklist/recipient-chip";
import { refreshEmailDelivery } from "@/lib/checklist-email-actions";
import type { StepEmailRecipient } from "@/types/database";

// Primeiro minuto: pergunta a cada 3 s (o normal é o servidor do destinatário
// responder em segundos); depois a cada 15 s. Desiste 10 min depois de a linha
// aparecer a caminho nesta tela — quem seguir "enviando" volta a ser consultado
// quando a tela abrir de novo.
const FAST_MS = 3_000;
const SLOW_MS = 15_000;
const FAST_FOR_MS = 60_000;
const GIVE_UP_MS = 10 * 60_000;

type Row = { id: string; recipients: StepEmailRecipient[] };

const onTheWay = (r: StepEmailRecipient) =>
  r.delivery?.state === "sending" || r.delivery?.state === "delayed";
const isFinal = (r: StepEmailRecipient) => !!r.delivery_issue || r.delivery?.state === "delivered";

/**
 * Chips de e-mail "ao vivo": enquanto algum destinatário das linhas está a
 * caminho, pergunta ao servidor — que pergunta ao Resend — a cada poucos
 * segundos, e o chip vira entregue ou devolvido sem recarregar. Quando um
 * e-mail volta, avisa também por toast: é o que a pessoa precisa ver.
 *
 * Devolve as linhas com os destinatários atualizados. O que veio do servidor e
 * já é final (entregue / devolvido) vale sobre o da consulta.
 */
export function useLiveDelivery<T extends Row>(rows: T[] | null): T[] | null {
  const [live, setLive] = useState<Record<string, StepEmailRecipient[]>>({});

  const merged = useMemo(
    () =>
      rows?.map((row) => {
        const fresh = live[row.id];
        if (!fresh) return row;
        // Mesma linha, mesmo array de destinatários: casa pela posição.
        return { ...row, recipients: row.recipients.map((r, i) => (fresh[i] && !isFinal(r) ? fresh[i] : r)) };
      }) ?? null,
    [rows, live]
  );

  const pendingKey = (merged ?? [])
    .filter((row) => row.recipients.some(onTheWay))
    .map((row) => row.id)
    .join(",");

  const latest = useRef(merged);
  useEffect(() => {
    latest.current = merged;
  });
  // Quando cada linha apareceu a caminho — base do "desiste em 10 min".
  const firstSeen = useRef(new Map<string, number>());

  useEffect(() => {
    if (!pendingKey) return;
    const ids = pendingKey.split(",");
    for (const id of ids) if (!firstSeen.current.has(id)) firstSeen.current.set(id, Date.now());
    const age = (id: string) => Date.now() - (firstSeen.current.get(id) ?? Date.now());

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      const youngest = Math.min(...ids.map(age));
      if (youngest > GIVE_UP_MS) return;
      timer = setTimeout(tick, youngest < FAST_FOR_MS ? FAST_MS : SLOW_MS);
    };

    const tick = async () => {
      const due = ids.filter((id) => age(id) <= GIVE_UP_MS);
      if (due.length && document.visibilityState === "visible") {
        const res = await refreshEmailDelivery(due).catch(() => null);
        if (cancelled) return;
        if (res?.ok) {
          announceBounces(latest.current ?? [], res.recipients);
          setLive((prev) => ({ ...prev, ...res.recipients }));
        }
      }
      if (!cancelled) schedule();
    };

    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pendingKey]);

  return merged;
}

/** Toast para quem estava a caminho na tela e voltou com problema. */
function announceBounces(rows: Row[], fresh: Record<string, StepEmailRecipient[]>) {
  for (const row of rows) {
    const next = fresh[row.id];
    if (!next) continue;
    row.recipients.forEach((before, i) => {
      const issue = next[i]?.delivery_issue;
      if (onTheWay(before) && issue) {
        toast.error(`Email to ${before.email} didn't arrive`, { description: DELIVERY_ISSUE_LABEL[issue.event] });
      }
    });
  }
}
