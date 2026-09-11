"use server";

import { randomUUID } from "node:crypto";

import { headers } from "next/headers";
import { z } from "zod";

import { requireFeature, requireInternal } from "@/lib/dal";
import { fetchAll } from "@/lib/fetch-all";
import { STEP_LABELS } from "@/lib/checklist";
import { loadRepliesByEmailIds } from "@/lib/checklist-emails";
import { checklistStepEmailHtml, type EmailLanguage, type StepEmailFacts } from "@/lib/email/checklist-step";
import { sendEmail } from "@/lib/email/resend";
import {
  loadQuotedHistory,
  peekQuotedHistory,
  promoteAnchorIfMissing,
  recordThreadFanout,
  resolveThreadsForSend,
  threadingHeaders,
  type QuotedMessage,
} from "@/lib/email/threads";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ChecklistStep, StepEmailRecipient, StepEmailReply } from "@/types/database";

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
  /** Respostas do cliente por e-mail (Resend inbound), mais antiga primeiro. */
  replies: StepEmailReply[];
};

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Domínio pro qual a resposta do cliente volta — derivado de `EMAIL_FROM`
 * ("SOTWISE <no-reply@mail.gssdatahub.com>" → "mail.gssdatahub.com"), não
 * hardcoded: o mesmo domínio já verificado no Resend pra ENVIO é o que
 * precisa ter "Receiving" ativado (ver docs/regras_de_negocio.md).
 */
function replyDomain(): string {
  const match = (process.env.EMAIL_FROM ?? "").match(/@([^>\s]+)/);
  return match?.[1] ?? "resend.dev";
}

/** Endereço de resposta da THREAD (Fase 2 do threading) — o id de
 *  `email_threads` é o token que o webhook usa pra achar a conversa de
 *  volta; a etapa exata respondida ele descobre pelo `In-Reply-To` do e-mail
 *  recebido contra o `message_id` gravado em cada linha (ver
 *  app/api/webhooks/resend). E-mails de antes da Fase 2 continuam com o token
 *  = id da própria linha, e o webhook ainda entende os dois formatos. */
function replyToAddress(threadId: string): string {
  return `reply+${threadId}@${replyDomain()}`;
}

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
const EMPTY_FACTS: StepEmailFacts = { estimatedDate: null, completedOn: null, responsible: null, signedBy: null };

async function loadStepFacts(admin: Admin, owner: StepOwner, stepId: string): Promise<StepEmailFacts> {
  const table = owner.kind === "order" ? "order_checklist_steps" : "pre_loading_checklist_steps";
  const { data } = await admin
    .from(table)
    .select("estimated_date, completed_on, responsible_id, signed_by_id")
    .eq("id", stepId)
    .maybeSingle();
  if (!data) return EMPTY_FACTS;

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

/**
 * Renderiza as duas variantes (interna/cliente) do e-mail — mesma lógica pro
 * envio de verdade (`sendStepEmail`) e pro preview (`previewStepEmail`), pra
 * nunca divergirem. `stepId` nulo (Pre-loading/Shipment cuja etapa nunca foi
 * tocada) cai em facts vazios + idioma 'en', igual ao que `sendStepEmail`
 * produziria ao criar a linha na hora (`ensureStepId`).
 */
async function renderStepEmailHtmls(
  admin: Admin,
  owner: StepOwner,
  stepId: string | null,
  senderName: string,
  input: { subject: string; body: string; recordPath: string; step: ChecklistStep },
  quoted: QuotedMessage[]
): Promise<{ internalHtml: string; clientHtml: string; language: EmailLanguage }> {
  const [facts, language, origin] = await Promise.all([
    stepId ? loadStepFacts(admin, owner, stepId) : Promise.resolve(EMPTY_FACTS),
    stepId ? resolveLanguage(admin, owner, stepId) : Promise.resolve<EmailLanguage>("en"),
    currentOrigin(),
  ]);
  const actionUrl = origin ? `${origin}${input.recordPath}` : null;
  const logoUrl = origin ? `${origin}/logo-sotwise.svg` : null;
  // Assunto é fixo por pedido ("Order #1637") pra a caixa de entrada agrupar
  // a conversa — a etapa, que antes ia no assunto, vai em destaque no corpo.
  const stepLabel = STEP_LABELS[input.step];

  return {
    internalHtml: checklistStepEmailHtml({
      subject: input.subject,
      stepLabel,
      senderName,
      body: input.body,
      facts,
      actionUrl,
      logoUrl,
      language,
      quoted,
    }),
    clientHtml: checklistStepEmailHtml({
      subject: input.subject,
      stepLabel,
      senderName,
      body: input.body,
      logoUrl,
      language,
      quoted,
    }),
    language,
  };
}

export async function loadStepEmailHistory(owner: StepOwner): Promise<StepEmailRow[]> {
  const session = await requireInternal();
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

  const repliesByEmailId = await loadRepliesByEmailIds(
    admin,
    rows.map((r) => r.id),
    session.userId
  );

  return rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    body: r.body,
    sender_name: nameById.get(r.sender_id) ?? "—",
    recipients: r.recipients,
    created_at: r.created_at,
    status: r.status,
    replies: repliesByEmailId.get(r.id) ?? [],
  }));
}

/** "Mark as read" de UMA resposta, chamado ao abrir o card no histórico
 *  (mesmo espírito de `markThreadRead` do módulo de mensagens). */
export async function markEmailReplyRead(replyId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireInternal();
  const admin = createAdminClient();
  const { error } = await admin
    .from("checklist_step_email_reply_recipients")
    .update({ read_at: new Date().toISOString() })
    .eq("reply_id", replyId)
    .eq("user_id", session.userId)
    .is("read_at", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

const sendSchema = z.object({
  feature: z.enum(["orders", "pre_loading", "shipments"]),
  recipient_ids: z.array(z.uuid()).min(1, "Select at least one recipient."),
  subject: z.string().trim().min(1, "Write a subject.").max(200, "Subject is too long."),
  body: z.string().trim().min(1, "Write a message.").max(5000, "Message is too long."),
  /** Caminho da tela de origem (ex: "/orders/<id>") — vira o botão "Go to" pro
   *  destinatário interno; cliente nunca recebe esse link. */
  recordPath: z.string().trim().min(1),
  /** Etapa do checklist que está compondo — decide em qual `email_threads` da
   *  Order o envio entra (ver `lib/email/threads.ts`) e vira o título em
   *  destaque no corpo do e-mail. `previewStepEmail` só usa pro título
   *  (preview nunca cria/toca thread nenhuma). */
  step: z.enum([
    "order",
    "po",
    "pi",
    "deposit_payment",
    "packing_confirm",
    "condition_confirm",
    "place_the_order",
    "etd",
    "balance_payment",
    "pre_loading",
    "consolidation_point",
    "city",
    "port_of_loading",
    "shipping_docs",
    "agents",
    "booking",
    "loading_date",
    "shipping_date",
    "bl",
    "original_docs",
    "inspection_report",
    "eta_brazil",
    "ata_brazil",
    "delivered",
  ]),
});

export type SendStepEmailInput = z.infer<typeof sendSchema>;

export type StepEmailDefaults = { customerName: string | null; senderName: string };

/**
 * Nome do(s) cliente(s) da etapa + nome de quem está compondo agora — só pro
 * compositor substituir `[Customer Name]`/`[Your Name]` do template padrão
 * (`lib/email/step-templates.ts`) toda vez que abre, sem depender de digitação
 * manual. Cliente vem `null` quando a etapa não resolve nenhum (fica o
 * colchete original, editável à mão) — mesma resolução de `resolveLanguage`,
 * mas devolvendo o nome em vez do idioma.
 */
export async function loadStepEmailDefaults(owner: StepOwner): Promise<StepEmailDefaults> {
  const session = await requireInternal();
  const admin = createAdminClient();
  const stepId = await findStepId(admin, owner);
  const clientIds = stepId ? await loadOwnerClientIds(admin, owner, stepId) : [];
  let customerName: string | null = null;
  if (clientIds.length > 0) {
    const { data } = await admin.from("clients").select("name").in("id", clientIds);
    customerName = (data ?? []).map((c) => c.name).join(", ") || null;
  }
  return { customerName, senderName: session.profile.full_name };
}

export type StepEmailPreview = { internalHtml: string | null; clientHtml: string | null };

/**
 * Mesmo HTML que `sendStepEmail` mandaria, sem mandar nada — só leitura (usa
 * `findStepId`, nunca `ensureStepId`). `internalHtml`/`clientHtml` vêm `null`
 * quando nenhum destinatário escolhido é daquele tipo, pra o compositor não
 * oferecer uma aba de preview que não corresponde a ninguém selecionado.
 */
export async function previewStepEmail(
  owner: StepOwner,
  input: SendStepEmailInput
): Promise<{ ok: true; preview: StepEmailPreview } | { ok: false; error: string }> {
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const session = await requireFeature(parsed.data.feature, "edit");
  const admin = createAdminClient();

  const recipientIds = [...new Set(parsed.data.recipient_ids)];
  const [stepId, isClientById, quoted] = await Promise.all([
    findStepId(admin, owner),
    loadIsClientByUserId(admin, recipientIds),
    peekQuotedHistory(admin, owner, parsed.data.step),
  ]);
  const { internalHtml, clientHtml } = await renderStepEmailHtmls(
    admin,
    owner,
    stepId,
    session.profile.full_name,
    parsed.data,
    quoted
  );

  const hasInternal = recipientIds.some((id) => !isClientById.get(id));
  const hasClient = recipientIds.some((id) => isClientById.get(id));

  return {
    ok: true,
    preview: { internalHtml: hasInternal ? internalHtml : null, clientHtml: hasClient ? clientHtml : null },
  };
}

/**
 * Envio síncrono, UMA mensagem por grupo de destinatários (equipe / cliente),
 * com todos do grupo no "To" — decisão do usuário em 11/09/2026, pra que um
 * "Responder a todos" alcance o grupo inteiro e não só o SOTWISE. Antes era
 * uma mensagem por pessoa (ninguém via o endereço dos colegas); a separação
 * equipe × cliente foi mantida porque cliente nunca pode ver os campos
 * internos nem o botão "Go to" — e, de lambuja, um grupo não enxerga os
 * endereços do outro. Sem fila/outbox — é uma ação manual e pontual, não um
 * evento de sistema; o resultado de cada destinatário já fica congelado na
 * ÚNICA linha de histórico, independente de sucesso total, parcial ou falha
 * total.
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

  // Destinatário `client` nunca recebe Estimated date/Responsible/Completed
  // on/Signed by nem o botão "Go to" — quem decide é o PAPEL do destinatário,
  // não o remetente, então o e-mail muda por pessoa mesmo sendo o mesmo envio.
  // O logo é só marca — vai pros dois. Idioma (Fase 2.1 US1) é o mesmo pros dois.
  const [isClientById, threadsResult] = await Promise.all([
    loadIsClientByUserId(admin, recipientIds),
    resolveThreadsForSend(admin, owner, parsed.data.step),
  ]);
  // Sem thread resolvida, não manda e-mail nenhum — nunca cai num modo "sem
  // thread" silencioso (ver lib/email/threads.ts).
  if (!threadsResult.ok) return { ok: false, error: threadsResult.error };
  const threads = threadsResult.threads;
  const primaryThread = threads[0];

  // Cabeçalhos que fazem o e-mail chegar como Reply do primeiro da conversa
  // (vazio se este é o primeiro) + histórico anterior citado no rodapé.
  // Resolvidos UMA vez, iguais pra todos os destinatários deste envio.
  const [threadHeaders, quoted] = await Promise.all([
    threadingHeaders(admin, threads),
    loadQuotedHistory(admin, primaryThread.id),
  ]);
  const { internalHtml, clientHtml, language } = await renderStepEmailHtmls(
    admin,
    owner,
    stepRow.id,
    session.profile.full_name,
    parsed.data,
    quoted
  );
  const replyTo = replyToAddress(primaryThread.id);
  // "Re:" só no que sai pelo SMTP, e só quando é de fato uma resposta — a
  // linha do histórico guarda o assunto como o usuário digitou.
  const smtpSubject =
    threadHeaders["In-Reply-To"] && !/^re:/i.test(parsed.data.subject)
      ? `Re: ${parsed.data.subject}`
      : parsed.data.subject;

  // Id da linha gerado antes do insert: é gravado explícito no insert final e
  // usado no fan-out/âncora logo depois.
  const emailRowId = randomUUID();

  // Todos os destinatários do mesmo tipo vão numa ÚNICA mensagem, todos no
  // "To" (decisão do usuário em 11/09/2026): assim eles se veem e um
  // "Responder a todos" alcança o grupo inteiro + o SOTWISE, em vez de a
  // resposta só voltar pro sistema. Continuam sendo DUAS mensagens quando o
  // envio mistura equipe e cliente — o cliente nunca pode ver os campos
  // internos/botão "Go to" (regra antiga, mais forte que a novidade do Cc),
  // e de quebra um grupo não enxerga os endereços do outro.
  const people = await Promise.all(
    recipientIds.map(async (userId) => {
      const { data } = await admin.auth.admin.getUserById(userId);
      return {
        userId,
        name: nameById.get(userId) ?? "—",
        email: data.user?.email ?? null,
        isClient: isClientById.get(userId) === true,
      };
    })
  );

  const recipients: StepEmailRecipient[] = people
    .filter((p) => !p.email)
    .map((p) => ({ user_id: p.userId, name: p.name, email: "", ok: false, error: "No e-mail on file." }));

  for (const group of [false, true]) {
    const members = people.filter((p) => p.email && p.isClient === group);
    if (members.length === 0) continue;
    const sent = await sendEmail({
      to: members.map((p) => p.email as string),
      subject: smtpSubject,
      html: group ? clientHtml : internalHtml,
      replyTo,
      headers: threadHeaders,
    });
    for (const p of members) {
      recipients.push({
        user_id: p.userId,
        name: p.name,
        email: p.email as string,
        ok: sent.ok,
        error: sent.ok ? null : sent.error,
        // Message-ID da mensagem do GRUPO — o webhook casa o In-Reply-To da
        // resposta contra ele (todos do grupo respondem a mesma mensagem).
        message_id: sent.ok ? sent.messageId : null,
      });
    }
  }

  const ownerFields =
    owner.kind === "order"
      ? { checklist_step_id: stepRow.id, pre_loading_step_id: null }
      : { checklist_step_id: null, pre_loading_step_id: stepRow.id };

  // Status computado uma vez e congelado (Fase 2.1 US3) — nunca recalculado a
  // partir de `recipients` na leitura.
  const sent = recipients.filter((r) => r.ok).length;
  const failed = recipients.length - sent;
  const rowMessageId = recipients.find((r) => r.ok && r.message_id)?.message_id ?? null;
  const status: "success" | "partial" | "failed" =
    sent === recipients.length ? "success" : sent === 0 ? "failed" : "partial";

  const { error: insertError } = await admin.from("checklist_step_emails").insert({
    id: emailRowId,
    ...ownerFields,
    sender_id: session.userId,
    subject: parsed.data.subject,
    body: parsed.data.body,
    recipients,
    status,
    language,
    // threads[0] é sempre a PRIMÁRIA (ver resolveThreadsForSend). message_id
    // da linha = o do primeiro destinatário entregue (os demais ficam em
    // recipients[].message_id); in_reply_to = a âncora que este envio respondeu.
    thread_id: primaryThread.id,
    message_id: rowMessageId,
    in_reply_to_message_id: threadHeaders["In-Reply-To"] ?? null,
  });
  if (insertError) return { ok: false, error: insertError.message };

  // Fan-out + âncora. Roda mesmo se sent === 0: a linha existe de qualquer
  // forma (igual ao status "failed" já gravado), então a thread também deve
  // refletir isso — sem Message-ID ela só não vira âncora de cabeçalho.
  await recordThreadFanout(admin, threads, emailRowId);
  for (const t of threads) {
    await promoteAnchorIfMissing(admin, t.id, emailRowId, rowMessageId);
  }

  if (sent === 0) return { ok: false, error: "Could not deliver to any recipient." };
  return { ok: true, sent, failed };
}
