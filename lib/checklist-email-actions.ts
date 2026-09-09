"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { requireFeature, requireInternal } from "@/lib/dal";
import { fetchAll } from "@/lib/fetch-all";
import { checklistStepEmailHtml, type EmailLanguage, type StepEmailFacts } from "@/lib/email/checklist-step";
import { sendEmail } from "@/lib/email/resend";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ChecklistStep, StepEmailRecipient } from "@/types/database";

export type Option = { id: string; name: string };

/**
 * E-mail manual disparado a partir de UMA etapa do checklist, com destinatários
 * escolhidos à mão (diferente do `messages`, que é 100% interno, e do
 * `client_notifications`, que é automático). Order tem sua própria tabela de
 * etapas; Pre-loading e Shipment compartilham o checklist único do PL — só a
 * etapa (`step`) muda entre as duas telas.
 */
export type StepOwner =
  | { kind: "order"; stepId: string }
  | { kind: "pre_loading"; preLoadingId: string; step: ChecklistStep };

export type StepEmailRow = {
  id: string;
  subject: string;
  body: string;
  sender_name: string;
  recipients: StepEmailRecipient[];
  created_at: string;
  /** Nulo só em linhas de antes da Fase 2.1 (coluna aditiva, sem backfill). */
  status: "success" | "partial" | "failed" | null;
};

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Destinatários selecionáveis — ativos, não ocultos. Mesmo critério do
 * "Forward to" do módulo de mensagens (`loadPeople` em `lib/messages-actions.ts`),
 * duplicado aqui de propósito: são módulos independentes, sem razão pra
 * acoplar um ao outro por uma query de 6 linhas.
 */
export async function loadStepRecipientOptions(): Promise<Option[]> {
  await requireInternal();
  const admin = createAdminClient();
  const data = await fetchAll<{ id: string; full_name: string }>((from, to) =>
    admin
      .from("profiles")
      .select("id, full_name")
      .eq("status", "active")
      .eq("hidden", false)
      .order("full_name")
      .range(from, to)
  );
  return data.filter((p) => p.full_name.trim()).map((p) => ({ id: p.id, name: p.full_name }));
}

/** Acha o id da linha de etapa sem criar — etapa nunca tocada não tem e-mail
 *  nenhum, não há por que criar linha só pra ler histórico vazio. */
async function findStepId(admin: Admin, owner: StepOwner): Promise<string | null> {
  if (owner.kind === "order") return owner.stepId;
  const { data } = await admin
    .from("pre_loading_checklist_steps")
    .select("id")
    .eq("pre_loading_id", owner.preLoadingId)
    .eq("step", owner.step)
    .maybeSingle();
  return data?.id ?? null;
}

/** Mesmo `ensureStepId` já usado em orders/[id] e shipments/[id] pros anexos:
 *  a linha da etapa nasce sob demanda na primeira ação (anexo ou, agora, e-mail). */
async function ensureStepId(
  admin: Admin,
  owner: StepOwner
): Promise<{ id: string } | { error: string }> {
  if (owner.kind === "order") return { id: owner.stepId };

  const found = await findStepId(admin, owner);
  if (found) return { id: found };

  const { data, error } = await admin
    .from("pre_loading_checklist_steps")
    .insert({ pre_loading_id: owner.preLoadingId, step: owner.step })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not create the step." };
  return { id: data.id };
}

const ownerColumn = (owner: StepOwner) =>
  owner.kind === "order" ? ("checklist_step_id" as const) : ("pre_loading_step_id" as const);

/**
 * Os mesmos campos exibidos na tela (Estimated date/Responsible/Completed
 * on/Signed by) — só entram no e-mail de destinatário INTERNO (ver
 * `checklistStepEmailHtml`). Etapa recém-criada (`ensureStepId`) não tem
 * nada preenchido ainda; devolve tudo `null`, que o template já sabe omitir.
 */
async function loadStepFacts(admin: Admin, owner: StepOwner, stepId: string): Promise<StepEmailFacts> {
  const table = owner.kind === "order" ? "order_checklist_steps" : "pre_loading_checklist_steps";
  const { data } = await admin
    .from(table)
    .select("estimated_date, completed_on, responsible_id, signed_by_id")
    .eq("id", stepId)
    .maybeSingle();
  if (!data) return { estimatedDate: null, completedOn: null, responsible: null, signedBy: null };

  const profileIds = [data.responsible_id, data.signed_by_id].filter(
    (id): id is string => Boolean(id)
  );
  const nameById = new Map<string, string>();
  if (profileIds.length) {
    const { data: profs } = await admin.from("profiles").select("id, full_name").in("id", profileIds);
    for (const p of profs ?? []) nameById.set(p.id, p.full_name);
  }

  return {
    estimatedDate: data.estimated_date,
    completedOn: data.completed_on,
    responsible: data.responsible_id ? (nameById.get(data.responsible_id) ?? null) : null,
    signedBy: data.signed_by_id ? (nameById.get(data.signed_by_id) ?? null) : null,
  };
}

/** Cliente(s) do pedido/PL por trás da etapa — Order tem 1 (`orders.client_id`),
 *  Pre-loading/Shipment pode ter N (`pre_loading_clients`, consolidação). */
async function loadOwnerClientIds(admin: Admin, owner: StepOwner, stepId: string): Promise<string[]> {
  if (owner.kind === "order") {
    const { data: step } = await admin
      .from("order_checklist_steps")
      .select("order_id")
      .eq("id", stepId)
      .maybeSingle();
    if (!step?.order_id) return [];
    const { data: order } = await admin
      .from("orders")
      .select("client_id")
      .eq("id", step.order_id)
      .maybeSingle();
    return order?.client_id ? [order.client_id] : [];
  }
  const { data: rows } = await admin
    .from("pre_loading_clients")
    .select("client_id")
    .eq("pre_loading_id", owner.preLoadingId);
  return (rows ?? []).map((r) => r.client_id);
}

/**
 * Idioma do template (Fase 2.1 — User Story 1). Fonte primária:
 * `clients.language` (hoje sempre nulo — o GSS não manda idioma no customer,
 * confirmado batendo no endpoint ao vivo em 09/09; fica como override manual
 * ou gancho para um campo futuro do GSS). Fallback: `country_language_defaults`
 * pelo país do cliente. Sem cliente/país mapeado → 'en', nunca bloqueia o envio
 * (RN03). PL/Shipment com múltiplos clientes usa o primeiro que resolver.
 */
async function resolveLanguage(admin: Admin, owner: StepOwner, stepId: string): Promise<EmailLanguage> {
  const clientIds = await loadOwnerClientIds(admin, owner, stepId);
  if (clientIds.length === 0) return "en";

  const { data: clients } = await admin
    .from("clients")
    .select("id, language, country_id")
    .in("id", clientIds);

  const withLanguage = (clients ?? []).find((c) => c.language);
  if (withLanguage?.language) return withLanguage.language as EmailLanguage;

  const countryIds = [...new Set((clients ?? []).map((c) => c.country_id).filter((id): id is string => Boolean(id)))];
  if (countryIds.length === 0) return "en";

  const { data: defaults } = await admin
    .from("country_language_defaults")
    .select("country_id, language")
    .in("country_id", countryIds);
  return (defaults?.[0]?.language as EmailLanguage | undefined) ?? "en";
}

/**
 * Quem é `client` entre os destinatários escolhidos — é o que decide se o
 * e-mail dele traz os campos internos e o botão "Go to" (ver `sendStepEmail`).
 * Papel vem por join manual (roles é uma tabela de 4 linhas; não vale a pena
 * um embed do PostgREST pra isso).
 */
async function loadIsClientByUserId(
  admin: Admin,
  userIds: string[]
): Promise<Map<string, boolean>> {
  const { data: profiles } = await admin.from("profiles").select("id, role_id").in("id", userIds);
  const roleIds = [...new Set((profiles ?? []).map((p) => p.role_id))];
  const { data: roles } = roleIds.length
    ? await admin.from("roles").select("id, name").in("id", roleIds)
    : { data: [] };
  const roleNameById = new Map((roles ?? []).map((r) => [r.id, r.name]));
  return new Map(
    (profiles ?? []).map((p) => [p.id, roleNameById.get(p.role_id) === "client"])
  );
}

/** Origin da request atual, pro botão "Go to" virar um link absoluto. Fora de
 *  um ciclo de request (não deveria acontecer aqui, mas por segurança) o botão
 *  simplesmente some — sem link quebrado. */
async function currentOrigin(): Promise<string | undefined> {
  try {
    return (await headers()).get("origin") ?? undefined;
  } catch {
    return undefined;
  }
}

export async function loadStepEmailHistory(owner: StepOwner): Promise<StepEmailRow[]> {
  await requireInternal();
  const admin = createAdminClient();
  const stepId = await findStepId(admin, owner);
  if (!stepId) return [];

  const { data } = await admin
    .from("checklist_step_emails")
    .select("id, subject, body, sender_id, recipients, created_at, status")
    .eq(ownerColumn(owner), stepId)
    .order("created_at", { ascending: false });

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const senderIds = [...new Set(rows.map((r) => r.sender_id))];
  const { data: senders } = await admin
    .from("profiles")
    .select("id, full_name")
    .in("id", senderIds);
  const nameById = new Map((senders ?? []).map((s) => [s.id, s.full_name]));

  return rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    body: r.body,
    sender_name: nameById.get(r.sender_id) ?? "—",
    recipients: r.recipients,
    created_at: r.created_at,
    status: r.status,
  }));
}

const sendSchema = z.object({
  feature: z.enum(["orders", "pre_loading", "shipments"]),
  recipient_ids: z.array(z.uuid()).min(1, "Select at least one recipient."),
  subject: z.string().trim().min(1, "Write a subject.").max(200, "Subject is too long."),
  body: z.string().trim().min(1, "Write a message.").max(5000, "Message is too long."),
  /** Caminho da tela de origem (ex: "/orders/<id>") — vira o botão "Go to" pro
   *  destinatário interno; cliente nunca recebe esse link. */
  recordPath: z.string().trim().min(1),
});

export type SendStepEmailInput = z.infer<typeof sendSchema>;

/**
 * Envio síncrono, um `sendEmail` por destinatário (igual ao loop de
 * `domain/client/notifications.ts`): ninguém vê o e-mail dos colegas, e uma
 * falha individual não derruba os outros. Sem fila/outbox — é uma ação manual
 * e pontual, não um evento de sistema; o resultado de cada destinatário já
 * fica congelado na ÚNICA linha de histórico, independente de sucesso total,
 * parcial ou falha total.
 */
export async function sendStepEmail(
  owner: StepOwner,
  input: SendStepEmailInput
): Promise<{ ok: true; sent: number; failed: number } | { ok: false; error: string }> {
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const session = await requireFeature(parsed.data.feature, "edit");
  const admin = createAdminClient();

  const stepRow = await ensureStepId(admin, owner);
  if ("error" in stepRow) return { ok: false, error: stepRow.error };

  const recipientIds = [...new Set(parsed.data.recipient_ids)];
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name")
    .in("id", recipientIds);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  const [facts, isClientById, origin, language] = await Promise.all([
    loadStepFacts(admin, owner, stepRow.id),
    loadIsClientByUserId(admin, recipientIds),
    currentOrigin(),
    resolveLanguage(admin, owner, stepRow.id),
  ]);
  const actionUrl = origin ? `${origin}${parsed.data.recordPath}` : null;
  const logoUrl = origin ? `${origin}/logo-sotwise.svg` : null;

  // Destinatário `client` nunca recebe Estimated date/Responsible/Completed
  // on/Signed by nem o botão "Go to" — quem decide é o PAPEL do destinatário,
  // não o remetente, então o e-mail muda por pessoa mesmo sendo o mesmo envio.
  // O logo é só marca — vai pros dois. Idioma (Fase 2.1 US1) é o mesmo pros dois.
  const internalHtml = checklistStepEmailHtml({
    subject: parsed.data.subject,
    senderName: session.profile.full_name,
    body: parsed.data.body,
    facts,
    actionUrl,
    logoUrl,
    language,
  });
  const clientHtml = checklistStepEmailHtml({
    subject: parsed.data.subject,
    senderName: session.profile.full_name,
    body: parsed.data.body,
    logoUrl,
    language,
  });

  const recipients: StepEmailRecipient[] = [];
  for (const userId of recipientIds) {
    const { data } = await admin.auth.admin.getUserById(userId);
    const email = data.user?.email ?? null;
    const name = nameById.get(userId) ?? "—";
    if (!email) {
      recipients.push({ user_id: userId, name, email: "", ok: false, error: "No e-mail on file." });
      continue;
    }
    const html = isClientById.get(userId) ? clientHtml : internalHtml;
    const sent = await sendEmail({ to: email, subject: parsed.data.subject, html });
    recipients.push({
      user_id: userId,
      name,
      email,
      ok: sent.ok,
      error: sent.ok ? null : sent.error,
    });
  }

  const ownerFields =
    owner.kind === "order"
      ? { checklist_step_id: stepRow.id, pre_loading_step_id: null }
      : { checklist_step_id: null, pre_loading_step_id: stepRow.id };

  // Status computado uma vez e congelado (Fase 2.1 US3) — nunca recalculado a
  // partir de `recipients` na leitura.
  const sent = recipients.filter((r) => r.ok).length;
  const failed = recipients.length - sent;
  const status: "success" | "partial" | "failed" =
    sent === recipients.length ? "success" : sent === 0 ? "failed" : "partial";

  const { error: insertError } = await admin.from("checklist_step_emails").insert({
    ...ownerFields,
    sender_id: session.userId,
    subject: parsed.data.subject,
    body: parsed.data.body,
    recipients,
    status,
    language,
  });
  if (insertError) return { ok: false, error: insertError.message };

  if (sent === 0) return { ok: false, error: "Could not deliver to any recipient." };
  return { ok: true, sent, failed };
}
