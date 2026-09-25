"use client";

import { TriangleAlert, User } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import type { EmailDeliveryEvent, StepEmailRecipient } from "@/types/database";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const ISSUE_LABEL: Record<EmailDeliveryEvent, string> = {
  bounced: "Bounced — the address doesn't exist or rejected the email",
  suppressed: "Not sent — this address bounced before and is blocked",
  failed: "Delivery failed",
  complained: "Marked as spam by the recipient",
};

/**
 * Chip de um destinatário de e-mail da etapa. Verde = aceito pelo Resend;
 * vermelho = falhou no envio (`ok` false) ou o Resend avisou depois que não
 * chegou (`delivery_issue`: bounce, supressão, falha). Esses dois casos levam
 * ícone de alerta + tooltip explicando.
 */
export function RecipientChip({ recipient: r }: { recipient: StepEmailRecipient }) {
  const issue = r.delivery_issue;
  const failed = !r.ok || !!issue;

  const chip = (
    <span
      tabIndex={failed ? 0 : undefined}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        failed ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700",
        failed && "cursor-help"
      )}
    >
      {failed ? <TriangleAlert className="size-3" /> : <User className="size-3" />}
      {r.name}
    </span>
  );
  if (!failed) return chip;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{chip}</TooltipTrigger>
        <TooltipContent className="flex-col items-start gap-0.5">
          <span className="font-semibold">This email didn&apos;t reach {r.email}</span>
          <span>{issue ? ISSUE_LABEL[issue.event] : "Sending failed"}</span>
          {(issue?.reason ?? r.error) && (
            <span className="opacity-80">{issue?.reason ?? r.error}</span>
          )}
          {issue && <span className="opacity-60">{formatDateTime(issue.occurred_at)}</span>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
