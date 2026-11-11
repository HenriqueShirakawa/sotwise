"use client";

import type { ReactNode } from "react";
import { Clock, Loader2, MailCheck, TriangleAlert, User } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import type { EmailDeliveryProblem, StepEmailRecipient } from "@/types/database";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export const DELIVERY_ISSUE_LABEL: Record<EmailDeliveryProblem, string> = {
  bounced: "Bounced — the address doesn't exist or rejected the email",
  suppressed: "Not sent — this address bounced before and is blocked",
  failed: "Delivery failed",
  complained: "Marked as spam by the recipient",
};

const TONE = {
  red: "bg-rose-50 text-rose-700",
  amber: "bg-amber-50 text-amber-700",
  slate: "bg-slate-100 text-slate-600",
  green: "bg-emerald-50 text-emerald-700",
} as const;

type Look = {
  tone: keyof typeof TONE;
  icon: ReactNode;
  /** Sem título = chip sem tooltip. */
  title?: string;
  lines?: (string | null | undefined)[];
};

function lookOf(r: StepEmailRecipient): Look {
  const issue = r.delivery_issue;
  if (!r.ok || issue) {
    return {
      tone: "red",
      icon: <TriangleAlert className="size-3" />,
      title: `This email didn't reach ${r.email}`,
      lines: [
        issue ? DELIVERY_ISSUE_LABEL[issue.event] : "Sending failed",
        issue?.reason ?? r.error,
        issue ? formatDateTime(issue.occurred_at) : null,
      ],
    };
  }
  switch (r.delivery?.state) {
    case "sending":
      return {
        tone: "slate",
        icon: <Loader2 className="size-3 animate-spin" />,
        title: `Sending to ${r.email}…`,
        lines: ["Waiting for the recipient's mail server to confirm delivery."],
      };
    case "delayed":
      return {
        tone: "amber",
        icon: <Clock className="size-3" />,
        title: `Delivery to ${r.email} is delayed`,
        lines: ["The recipient's mail server hasn't accepted it yet — it's being retried. Turns red if it's rejected."],
      };
    case "unconfirmed":
      return {
        tone: "slate",
        icon: <User className="size-3" />,
        title: `Sent to ${r.email}`,
        lines: ["No delivery confirmation came back."],
      };
    case "delivered":
      return {
        tone: "green",
        icon: <MailCheck className="size-3" />,
        title: `Delivered to ${r.email}`,
        lines: [r.delivery.at ? formatDateTime(r.delivery.at) : null],
      };
    default:
      // Envio de antes do status por destinatário: só se sabe que o Resend aceitou.
      return { tone: "green", icon: <User className="size-3" /> };
  }
}

/**
 * Chip de um destinatário de e-mail da etapa:
 * - vermelho: falhou no envio (`ok` false) ou não chegou (`delivery_issue`:
 *   bounce, supressão, falha, spam);
 * - cinza girando: o Resend aceitou e o servidor do destinatário ainda não
 *   respondeu — a tela consulta sozinha (use-live-delivery.ts);
 * - âmbar: atraso (recusa temporária, o Resend segue tentando);
 * - verde com ✓: entregue;
 * - verde sem tooltip: envio antigo, de antes do status por destinatário.
 */
export function RecipientChip({ recipient: r }: { recipient: StepEmailRecipient }) {
  const look = lookOf(r);

  const chip = (
    <span
      tabIndex={look.title ? 0 : undefined}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE[look.tone],
        look.title && "cursor-help"
      )}
    >
      {look.icon}
      {r.name}
    </span>
  );
  if (!look.title) return chip;

  const [first, ...rest] = (look.lines ?? []).filter((l): l is string => Boolean(l));
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{chip}</TooltipTrigger>
        <TooltipContent className="flex-col items-start gap-0.5">
          <span className="font-semibold">{look.title}</span>
          {first && <span>{first}</span>}
          {rest.map((line, i) => (
            <span key={i} className={i === rest.length - 1 ? "opacity-60" : "opacity-80"}>
              {line}
            </span>
          ))}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
