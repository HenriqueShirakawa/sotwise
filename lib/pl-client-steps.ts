import "server-only";

import { hasStepPlan } from "@/lib/checklist-completion";
import { writeStepLog } from "@/lib/checklist-step-log";
import { formatDateNumeric, todayIso } from "@/lib/format";
import { loadPlClientState } from "@/lib/pl-clients";
import { autoCompletePlStep } from "@/lib/pl-step-autocomplete";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { ChecklistStep } from "@/types/database";

type Admin = ReturnType<typeof createAdminClient>;

/** Id da etapa do PL, criando a linha se ainda não existir. */
async function ensureStepId(
  admin: Admin,
  preLoadingId: string,
  step: ChecklistStep
): Promise<{ id: string } | { error: string }> {
  const { data: existing, error: readError } = await admin
    .from("pre_loading_checklist_steps")
    .select("id")
    .eq("pre_loading_id", preLoadingId)
    .eq("step", step)
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (existing) return { id: existing.id };
  const { data, error } = await admin
    .from("pre_loading_checklist_steps")
    .insert({ pre_loading_id: preLoadingId, step })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not create the step." };
  return { id: data.id };
}

async function clientName(admin: Admin, clientId: string): Promise<string> {
  const { data } = await admin.from("clients").select("name").eq("id", clientId).maybeSingle();
  return data?.name ?? "Client";
}

/**
 * Original Docs de UM cliente (22/10/2026): Tracking number OU Telex release —
 * ligado, o tracking deixa de ser exigido. A etapa fecha sozinha quando todos os
 * clientes têm documento + um dos dois (lib/pl-step-autocomplete). Vai pro
 * History da etapa como "Cliente: valor".
 */
export async function setClientOriginalDocs(
  admin: Admin,
  preLoadingId: string,
  clientId: string,
  patch: { tracking_number?: string | null; telex_release?: boolean },
  userId: string | null
): Promise<{ error: string | null; completed: boolean }> {
  const tracking =
    patch.tracking_number === undefined ? undefined : patch.tracking_number?.trim() || null;
  if (tracking && tracking.length > 100) return { error: "Tracking number is too long.", completed: false };

  const { data: existing, error: readError } = await admin
    .from("pre_loading_client_original_docs")
    .select("tracking_number, telex_release")
    .eq("pre_loading_id", preLoadingId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (readError) return { error: readError.message, completed: false };

  const before = {
    tracking_number: existing?.tracking_number ?? null,
    telex_release: existing?.telex_release ?? false,
  };
  const after = {
    tracking_number: tracking === undefined ? before.tracking_number : tracking,
    telex_release: patch.telex_release ?? before.telex_release,
  };
  if (after.tracking_number === before.tracking_number && after.telex_release === before.telex_release) {
    return { error: null, completed: false };
  }

  const { error } = await admin.from("pre_loading_client_original_docs").upsert(
    {
      pre_loading_id: preLoadingId,
      client_id: clientId,
      ...after,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "pre_loading_id,client_id" }
  );
  if (error) return { error: error.message, completed: false };

  const stepRow = await ensureStepId(admin, preLoadingId, "original_docs");
  if ("error" in stepRow) return { error: stepRow.error, completed: false };
  const label = await clientName(admin, clientId);
  const onOff = (v: boolean) => `${label}: ${v ? "On" : "Off"}`;
  await writeStepLog(admin, {
    owner: { preLoadingStepId: stepRow.id },
    step: "original_docs",
    action: "update",
    changes: {
      ...(after.tracking_number !== before.tracking_number
        ? {
            client_tracking_number: {
              from: before.tracking_number ? `${label}: ${before.tracking_number}` : null,
              to: after.tracking_number ? `${label}: ${after.tracking_number}` : null,
            },
          }
        : {}),
      ...(after.telex_release !== before.telex_release
        ? { client_telex_release: { from: onOff(before.telex_release), to: onOff(after.telex_release) } }
        : {}),
    },
    userId,
  });

  const completed = await autoCompletePlStep(admin, preLoadingId, "original_docs", userId, {
    refresh: true,
  });
  return { error: null, completed };
}

/**
 * Delivered date de UM cliente (PL com 2+ clientes, 22/10/2026) — mesmo molde
 * da data do fato (lib/pl-step-event-date): nunca futura; a 1ª é livre, trocar
 * exige motivo. Quando TODOS os clientes têm a data, a etapa conclui: a data do
 * fato dela vira a maior das datas, Completed on = hoje (a última atualização)
 * e Signed by = quem gravou.
 *
 * `completed` = a etapa acabou de concluir (quem chama aplica a regra do
 * Delivered — lotes e embarque entregues).
 */
export async function setClientDeliveredDate(
  admin: Admin,
  preLoadingId: string,
  clientId: string,
  date: string,
  who: { userId: string | null; reason?: string | null }
): Promise<{ error: string | null; completed: boolean }> {
  if (!date) return { error: "Choose the delivered date.", completed: false };
  if (date > todayIso()) return { error: "The delivered date can't be in the future.", completed: false };

  const { data: existing, error: readError } = await admin
    .from("pre_loading_client_delivered")
    .select("delivered_date")
    .eq("pre_loading_id", preLoadingId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (readError) return { error: readError.message, completed: false };
  const previous = existing?.delivered_date ?? null;
  if (previous === date) return { error: null, completed: false };

  const reason = who.reason?.trim() || null;
  if (previous && !reason) {
    return { error: "A reason is required to revise the delivered date.", completed: false };
  }

  const { error } = await admin.from("pre_loading_client_delivered").upsert(
    {
      pre_loading_id: preLoadingId,
      client_id: clientId,
      delivered_date: date,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "pre_loading_id,client_id" }
  );
  if (error) return { error: error.message, completed: false };

  const { data: step, error: stepError } = await admin
    .from("pre_loading_checklist_steps")
    .select("id, event_date, completed_on, signed_by_id, estimated_date, responsible_id")
    .eq("pre_loading_id", preLoadingId)
    .eq("step", "delivered")
    .maybeSingle();
  if (stepError) return { error: stepError.message, completed: false };
  const stepRow = step ?? (await ensureStepId(admin, preLoadingId, "delivered"));
  if ("error" in stepRow) return { error: stepRow.error, completed: false };

  const label = await clientName(admin, clientId);
  const changes: Record<string, unknown> = {
    client_delivered_date: {
      from: previous ? `${label}: ${formatDateNumeric(previous)}` : null,
      to: `${label}: ${formatDateNumeric(date)}`,
    },
    ...(previous && reason ? { reason } : {}),
  };

  // Todos os clientes com data? A etapa conclui (ou, já concluída, regrava) —
  // se tiver Estimated date + Responsible (26/10/2026); sem eles só a data do
  // Shipment é atualizada e a etapa fecha quando os dois forem preenchidos.
  const state = await loadPlClientState(admin, preLoadingId);
  const dates = state.clients.map((c) => state.delivered.get(c.id));
  let completed = false;
  if (state.clients.length > 0 && dates.every(Boolean)) {
    const latest = (dates as string[]).reduce((max, d) => (d > max ? d : max));
    const today = todayIso();
    const plan = !!step && hasStepPlan(step);
    const { error: upError } = await admin
      .from("pre_loading_checklist_steps")
      .update(
        plan
          ? { event_date: latest, completed_on: today, done: true, signed_by_id: who.userId }
          : { event_date: latest }
      )
      .eq("id", stepRow.id);
    if (upError) return { error: upError.message, completed: false };
    if (step?.event_date !== latest) changes.event_date = { from: step?.event_date ?? null, to: latest };
    if (plan) {
      completed = !step?.completed_on;
      if (step?.completed_on !== today) changes.completed_on = { from: step?.completed_on ?? null, to: today };
      if (step?.signed_by_id !== who.userId) {
        changes.signed_by_id = { from: step?.signed_by_id ?? null, to: who.userId };
      }
    }
  }

  await writeStepLog(admin, {
    owner: { preLoadingStepId: stepRow.id },
    step: "delivered",
    action: "update",
    changes,
    userId: who.userId,
  });
  return { error: null, completed };
}

/**
 * A Delivered date única (API / PL de 1 cliente) vale para TODOS os clientes do
 * PL — com 2+ clientes a etapa exige a data de cada um, e quem manda uma data
 * só está dizendo que o container inteiro chegou.
 */
export async function fillDeliveredForAllClients(
  admin: Admin,
  preLoadingId: string,
  date: string
): Promise<string | null> {
  const state = await loadPlClientState(admin, preLoadingId);
  if (state.clients.length < 2) return null;
  const now = new Date().toISOString();
  const { error } = await admin.from("pre_loading_client_delivered").upsert(
    state.clients.map((c) => ({
      pre_loading_id: preLoadingId,
      client_id: c.id,
      delivered_date: date,
      updated_at: now,
    })),
    { onConflict: "pre_loading_id,client_id" }
  );
  return error?.message ?? null;
}
