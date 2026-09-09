import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import type { StepEmailReply } from "@/types/database";

/**
 * Helpers de `checklist_step_email_replies` reaproveitados por dois módulos
 * "use server" (`lib/checklist-email-actions.ts` e
 * `lib/checklist-emails-list-actions.ts`) — igual `lib/messages.ts` existe
 * separado de `lib/messages-actions.ts` pelo mesmo motivo: um arquivo com
 * `"use server"` tem TODO export tratado como Server Action, e uma função que
 * recebe um client do Supabase como argumento não é o formato certo pra isso.
 */

type Admin = ReturnType<typeof createAdminClient>;

/** Respostas de um conjunto de linhas de `checklist_step_emails`, já
 *  hidratadas (nome resolvido, lida/não-lida do `viewerId`). */
export async function loadRepliesByEmailIds(
  admin: Admin,
  emailIds: string[],
  viewerId: string
): Promise<Map<string, StepEmailReply[]>> {
  const out = new Map<string, StepEmailReply[]>();
  if (emailIds.length === 0) return out;

  const { data: replies } = await admin
    .from("checklist_step_email_replies")
    .select("id, checklist_step_email_id, from_email, from_name, from_user_id, body_text, received_at")
    .in("checklist_step_email_id", emailIds)
    .order("received_at", { ascending: true });
  if (!replies?.length) return out;

  const fromUserIds = [...new Set(replies.map((r) => r.from_user_id).filter((id): id is string => Boolean(id)))];
  const { data: profiles } = fromUserIds.length
    ? await admin.from("profiles").select("id, full_name").in("id", fromUserIds)
    : { data: [] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  const replyIds = replies.map((r) => r.id);
  const { data: readRows } = await admin
    .from("checklist_step_email_reply_recipients")
    .select("reply_id, read_at")
    .eq("user_id", viewerId)
    .in("reply_id", replyIds);
  const readAtByReplyId = new Map((readRows ?? []).map((r) => [r.reply_id, r.read_at]));

  for (const r of replies) {
    const hydrated: StepEmailReply = {
      id: r.id,
      from_name: (r.from_user_id ? nameById.get(r.from_user_id) : null) ?? r.from_name,
      from_email: r.from_email,
      from_user_id: r.from_user_id,
      body_text: r.body_text,
      received_at: r.received_at,
      read_by_me: readAtByReplyId.get(r.id) != null,
    };
    const list = out.get(r.checklist_step_email_id) ?? [];
    list.push(hydrated);
    out.set(r.checklist_step_email_id, list);
  }
  return out;
}
