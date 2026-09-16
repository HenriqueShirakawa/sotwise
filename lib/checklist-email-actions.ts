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
import { threadKindForStep } from "@/lib/email/step-thread-kind";
import {
  loadQuotedHistory,
  peekQuotedHistory,
  promoteAnchorIfMissing,
  recordThreadFanout,
  replyToAddress,
  resolveOwnerOrders,
  resolveThreadsForOrderIds,
  threadingHeaders,
  type QuotedMessage,
  type ResolvedThread,
  type ThreadingHeaders,
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
  /** Order que esta linha respondeu de verdade (via `thread_id` →
   *  `email_threads.order_id`) — só resolvido pra owner Pre-loading/Shipment
   *  (Order já é 1:1 com sua própria etapa, sem ambiguidade de qual linha é
   *  de qual Order; ver o fan-out por Order em `sendStepEmail`). */
  order_po_number: string | null;
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

/** Um idioma + os clientes (do owner) que resolvem pra ele + o(s) nome(s)
 *  deles juntos (rótulo da aba/variante). */
type ClientLanguageGroup = { language: EmailLanguage; clientIds: string[]; customerName: string | null };

/**
 * Agrupa os clientes do owner por idioma resolvido — substitui a antiga
 * `resolveLanguageAndCustomerName` (Fase multi-idioma, 15/09/2026): aquela
 * pegava só o PRIMEIRO cliente com idioma e usava pra todo mundo, o que
 * mandava idioma errado pra quem não fosse desse — reportado pelo usuário
 * num Shipment com cliente zh + outros clientes.
 *
 * Cada cliente resolve o PRÓPRIO idioma (`clients.language` → override manual
 * em `/registration/clients` → `country_language_defaults` pelo seu país →
 * `'en'`, nunca bloqueia o envio — RN03), depois agrupa por idioma. Sempre
 * devolve ≥1 grupo (sem cliente nenhum → `[{language:'en', clientIds:[],
 * customerName:null}]`).
 *
 * `groups[0]` é sempre o grupo PRIMÁRIO: absorve Orders órfãos (cujo
 * `client_id` não bate com nenhum grupo — drift do `pre_loading_clients`,
 * editado à mão e independente dos Orders reais, ver
 * `app/(dashboard)/pre-loading/actions.ts`) e é o idioma que a equipe
 * interna sempre recebe (efeito já aceito desde o fix WYSIWYG, `284f20a`).
 * Desempate determinístico por nome do cliente — antes disto dependia da
 * ordem arbitrária que o Postgres devolvesse pro `.in(id, clientIds)`,
 * inofensivo enquanto só decidia 1 idioma pra tudo; agora decide também quem
 * absorve órfãos, então ganhou um critério explícito.
 */
async function resolveClientLanguageGroups(
  admin: Admin,
  owner: StepOwner,
  stepId: string
): Promise<ClientLanguageGroup[]> {
  const clientIds = await loadOwnerClientIds(admin, owner, stepId);
  if (clientIds.length === 0) return [{ language: "en", clientIds: [], customerName: null }];

  const { data: clientsData } = await admin
    .from("clients")
    .select("id, name, language, country_id")
    .in("id", clientIds);
  const clients = [...(clientsData ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  const countryIds = [...new Set(clients.map((c) => c.country_id).filter((id): id is string => Boolean(id)))];
  const { data: defaultsData } = countryIds.length
    ? await admin.from("country_language_defaults").select("country_id, language").in("country_id", countryIds)
    : { data: [] as { country_id: string; language: EmailLanguage }[] };
  const languageByCountry = new Map((defaultsData ?? []).map((d) => [d.country_id, d.language]));

  const groupsByLanguage = new Map<EmailLanguage, { clientIds: string[]; names: string[] }>();
  for (const client of clients) {
    const language: EmailLanguage =
      (client.language as EmailLanguage | null) ??
      (client.country_id ? languageByCountry.get(client.country_id) : undefined) ??
      "en";
    const group = groupsByLanguage.get(language) ?? { clientIds: [], names: [] };
    group.clientIds.push(client.id);
    group.names.push(client.name);
    groupsByLanguage.set(language, group);
  }

  if (groupsByLanguage.size === 0) return [{ language: "en", clientIds: [], customerName: null }];
  return [...groupsByLanguage.entries()].map(([language, group]) => ({
    language,
    clientIds: group.clientIds,
    customerName: group.names.join(", ") || null,
  }));
}

/** O que se sabe de um destinatário escolhido pra decidir variante (interno
 *  vs. cliente) e, desde a Fase multi-idioma, o GRUPO de idioma dele. */
type RecipientInfo = { isClient: boolean; clientId: string | null };

/**
 * Papel de cada destinatário (é `client`?) + `client_id` — o segundo é novo
 * (Fase multi-idioma, 15/09/2026): é o que liga um destinatário ao SEU
 * cliente/grupo de idioma (`profiles.client_id`, obrigatório no papel
 * `client` desde `20260819120000_client_role_and_scope.sql`, nunca usado
 * nesta feature até agora). Papel decide se o e-mail dele traz os campos
 * internos e o botão "Go to" (ver `sendStepEmail`); `client_id` decide EM
 * QUE IDIOMA ele recebe.
 */
async function loadRecipientInfoByUserId(
  admin: Admin,
  userIds: string[]
): Promise<Map<string, RecipientInfo>> {
  const { data: profiles } = await admin.from("profiles").select("id, role_id, client_id").in("id", userIds);
  const roleIds = [...new Set((profiles ?? []).map((p) => p.role_id))];
  const { data: roles } = roleIds.length
    ? await admin.from("roles").select("id, name").in("id", roleIds)
    : { data: [] };
  const roleNameById = new Map((roles ?? []).map((r) => [r.id, r.name]));
  return new Map(
    (profiles ?? []).map((p) => [
      p.id,
      { isClient: roleNameById.get(p.role_id) === "client", clientId: p.client_id },
    ])
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

type RenderedClientVariant = {
  language: EmailLanguage;
  html: string;
  /** Texto puro (não o HTML) — vai na coluna `body` de `checklist_step_emails`. */
  body: string;
  clientIds: string[];
  customerName: string | null;
};

/**
 * Renderiza a variante INTERNA + uma variante de e-mail por GRUPO DE IDIOMA
 * do owner — mesma lógica pro envio de verdade (`sendStepEmail`) e pro
 * preview (`previewStepEmail`), pra nunca divergirem. `stepId` nulo
 * (Pre-loading/Shipment cuja etapa nunca foi tocada) cai em facts vazios +
 * grupo único `'en'`, igual ao que `sendStepEmail` produziria ao criar a
 * linha na hora (`ensureStepId`).
 *
 * WYSIWYG desde 15/09/2026 (`284f20a`): cada variante usa o texto que está
 * na sua ABA do compositor (`input.bodies[group.language]`) — sem swap
 * escondido. A variante INTERNA usa sempre a aba do idioma PRIMÁRIO
 * (`groups[0]`) — mesmo efeito colateral já aceito quando só existe 1
 * idioma. `quoted`/`facts`/`actionUrl` continuam resolvidos uma vez só, a
 * partir da thread primária GERAL — simplificação já existente (o rodapé
 * citado de um PL multi-Order já só olhava pra 1 thread), mantida de
 * propósito: não é o bug reportado.
 */
async function renderStepEmailHtmls(
  admin: Admin,
  owner: StepOwner,
  stepId: string | null,
  senderName: string,
  input: { subject: string; bodies: Partial<Record<EmailLanguage, string>>; recordPath: string; step: ChecklistStep },
  quoted: QuotedMessage[]
): Promise<{
  internalHtml: string;
  internalBody: string;
  clientVariants: RenderedClientVariant[];
  primaryLanguage: EmailLanguage;
}> {
  const [facts, groups, origin] = await Promise.all([
    stepId ? loadStepFacts(admin, owner, stepId) : Promise.resolve(EMPTY_FACTS),
    stepId
      ? resolveClientLanguageGroups(admin, owner, stepId)
      : Promise.resolve([{ language: "en" as EmailLanguage, clientIds: [], customerName: null }]),
    currentOrigin(),
  ]);
  const primaryLanguage = groups[0].language;
  const actionUrl = origin ? `${origin}${input.recordPath}` : null;
  const logoUrl = origin ? `${origin}/logo-sotwise.svg` : null;
  // Assunto é fixo por pedido ("Order #1637") pra a caixa de entrada agrupar
  // a conversa — a etapa, que antes ia no assunto, vai em destaque no corpo.
  const stepLabel = STEP_LABELS[input.step];

  const fallbackBody = Object.values(input.bodies).find((b): b is string => Boolean(b?.trim())) ?? "";
  const internalBody = input.bodies[primaryLanguage]?.trim() ? input.bodies[primaryLanguage]! : fallbackBody;

  const internalHtml = checklistStepEmailHtml({
    subject: input.subject,
    stepLabel,
    senderName,
    body: internalBody,
    facts,
    actionUrl,
    logoUrl,
    language: primaryLanguage,
    quoted,
  });

  const clientVariants: RenderedClientVariant[] = groups.map((group) => {
    const body = input.bodies[group.language]?.trim() ? input.bodies[group.language]! : internalBody;
    return {
      language: group.language,
      clientIds: group.clientIds,
      customerName: group.customerName,
      body,
      html: checklistStepEmailHtml({
        subject: input.subject,
        stepLabel,
        senderName,
        body,
        logoUrl,
        language: group.language,
        quoted,
      }),
    };
  });

  return { internalHtml, internalBody, clientVariants, primaryLanguage };
}

export async function loadStepEmailHistory(owner: StepOwner): Promise<StepEmailRow[]> {
  const session = await requireInternal();
  const admin = createAdminClient();
  const stepId = await findStepId(admin, owner);
  if (!stepId) return [];

  const { data } = await admin
    .from("checklist_step_emails")
    .select("id, subject, body, sender_id, recipients, created_at, status, thread_id")
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

  // Qual Order cada linha respondeu de verdade — só vale a query pra owner
  // que consolida mais de 1 Order (Pre-loading/Shipment); pra Order já é 1:1.
  const poNumberByThreadId = new Map<string, string>();
  if (owner.kind !== "order") {
    const threadIds = [...new Set(rows.map((r) => r.thread_id).filter((id): id is string => Boolean(id)))];
    if (threadIds.length > 0) {
      const { data: threadRows } = await admin.from("email_threads").select("id, order_id").in("id", threadIds);
      const orderIdByThreadId = new Map((threadRows ?? []).map((t) => [t.id, t.order_id]));
      const orderIds = [...new Set([...orderIdByThreadId.values()])];
      const { data: orderRows } = orderIds.length
        ? await admin.from("orders").select("id, po_number").in("id", orderIds)
        : { data: [] as { id: string; po_number: string }[] };
      const poNumberByOrderId = new Map((orderRows ?? []).map((o) => [o.id, o.po_number]));
      for (const [threadId, orderId] of orderIdByThreadId) {
        const po = poNumberByOrderId.get(orderId);
        if (po) poNumberByThreadId.set(threadId, po);
      }
    }
  }

  return rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    body: r.body,
    sender_name: nameById.get(r.sender_id) ?? "—",
    recipients: r.recipients,
    created_at: r.created_at,
    status: r.status,
    replies: repliesByEmailId.get(r.id) ?? [],
    order_po_number: r.thread_id ? (poNumberByThreadId.get(r.thread_id) ?? null) : null,
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
  /** E-mails digitados à mão, de gente sem cadastro no SOTWISE (Fase 3).
   *  Sempre recebem a versão LIMPA do e-mail: sem perfil pra checar papel, o
   *  seguro é tratar como externo — e, sem `client_id`, sempre no idioma
   *  PRIMÁRIO do envio (ver `resolveClientLanguageGroups`). */
  ad_hoc_emails: z
    .array(z.email("Invalid e-mail address.").transform((e) => e.trim().toLowerCase()))
    .max(20, "Too many extra e-mails.")
    .default([]),
  subject: z.string().trim().min(1, "Write a subject.").max(200, "Subject is too long."),
  /** Uma aba por idioma (Fase multi-idioma, 15/09/2026) — antes era `body:
   *  string` único. `partialRecord` (não `record`, que no Zod v4 exigiria
   *  as 3 chaves sempre) porque a maioria dos envios só usa 1 idioma. */
  bodies: z
    .partialRecord(
      z.enum(["en", "pt-BR", "zh"]),
      z.string().trim().min(1, "Write a message.").max(5000, "Message is too long.")
    )
    .refine((b) => Object.keys(b).length > 0, "Write a message."),
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

export type StepEmailLanguageGroup = { language: EmailLanguage; customerName: string | null };
export type StepEmailDefaults = { senderName: string; groups: StepEmailLanguageGroup[] };

/**
 * Nome de quem está compondo agora + um grupo por idioma que a etapa resolve
 * (cliente(s) + idioma de cada) — pro compositor (a) abrir uma aba por
 * idioma, cada uma pré-populada com `buildDefaultStepBody` naquele idioma
 * (ver `lib/email/step-templates.ts`), sem depender de digitação manual, e
 * (b) só mostrar abas quando `groups.length > 1` (Fase multi-idioma,
 * 15/09/2026 — antes disto devolvia um único `{customerName, language}`,
 * sempre "o primeiro cliente que resolver").
 */
export async function loadStepEmailDefaults(owner: StepOwner): Promise<StepEmailDefaults> {
  const session = await requireInternal();
  const admin = createAdminClient();
  const stepId = await findStepId(admin, owner);
  const groups = stepId
    ? await resolveClientLanguageGroups(admin, owner, stepId)
    : [{ language: "en" as EmailLanguage, clientIds: [], customerName: null }];
  return {
    senderName: session.profile.full_name,
    groups: groups.map((g) => ({ language: g.language, customerName: g.customerName })),
  };
}

export type StepEmailClientVariant = { language: EmailLanguage; html: string; customerName: string | null };
export type StepEmailPreview = {
  internalHtml: string | null;
  /** Uma entrada por idioma que TEM destinatário selecionado neste preview —
   *  vazio se nenhum destinatário/avulso é do tipo cliente (ver `sendStepEmail`). */
  clientVariants: StepEmailClientVariant[];
  primaryLanguage: EmailLanguage;
};

/**
 * Mesmo HTML que `sendStepEmail` mandaria, sem mandar nada — só leitura (usa
 * `findStepId`, nunca `ensureStepId`). `internalHtml` vem `null` quando
 * nenhum destinatário escolhido é interno; `clientVariants` só lista os
 * idiomas que TÊM destinatário/avulso selecionado agora, pro compositor não
 * oferecer uma aba de preview que não corresponde a ninguém.
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
  const adHocEmails = [...new Set(parsed.data.ad_hoc_emails)];
  const [stepId, recipientInfoById, quoted] = await Promise.all([
    findStepId(admin, owner),
    loadRecipientInfoByUserId(admin, recipientIds),
    peekQuotedHistory(admin, owner, parsed.data.step),
  ]);
  const { internalHtml, clientVariants, primaryLanguage } = await renderStepEmailHtmls(
    admin,
    owner,
    stepId,
    session.profile.full_name,
    parsed.data,
    quoted
  );

  // Etapa de conversa com o cliente (`external`): TODO MUNDO recebe a versão
  // limpa — sem campos internos e sem botão "Go to", só ler e responder
  // (decisão do usuário em 11/09/2026). Ver `sendStepEmail`.
  const externalThread = threadKindForStep(parsed.data.step) === "external";
  const isPlain = (id: string) => externalThread || recipientInfoById.get(id)?.isClient === true;
  const hasInternal = !externalThread && recipientIds.some((id) => !isPlain(id));

  // clientId -> idioma do grupo, pra saber em qual variante cada destinatário
  // "plain" cai. Avulso e destinatário cujo client_id não bate com nenhum
  // grupo (fora de escopo do PL, ou simplesmente sem client_id) caem no
  // idioma PRIMÁRIO — mesma regra de `sendStepEmail`.
  const clientIdToLanguage = new Map<string, EmailLanguage>();
  for (const variant of clientVariants) {
    for (const clientId of variant.clientIds) clientIdToLanguage.set(clientId, variant.language);
  }
  const languageForRecipient = (id: string): EmailLanguage => {
    const clientId = recipientInfoById.get(id)?.clientId ?? null;
    return (clientId && clientIdToLanguage.get(clientId)) || primaryLanguage;
  };

  const activeLanguages = new Set<EmailLanguage>();
  if (adHocEmails.length > 0) activeLanguages.add(primaryLanguage);
  for (const id of recipientIds) {
    if (isPlain(id)) activeLanguages.add(languageForRecipient(id));
  }

  return {
    ok: true,
    preview: {
      internalHtml: hasInternal ? internalHtml : null,
      clientVariants: clientVariants
        .filter((v) => activeLanguages.has(v.language))
        .map((v) => ({ language: v.language, html: v.html, customerName: v.customerName })),
      primaryLanguage,
    },
  };
}

type Person = {
  userId: string | null;
  name: string;
  email: string | null;
  /** Idioma do grupo que este destinatário pertence — `null` pra quem é
   *  puramente interno (não "plain"), que não é agrupado por idioma. Quem
   *  tem idioma É o destinatário "plain" (papel `client`, avulso, ou
   *  qualquer um numa etapa `external`) — substitui o antigo `isClient`
   *  booleano, que só servia pra essa mesma distinção. */
  language: EmailLanguage | null;
};
type PersonWithEmail = Person & { email: string };

/** Grava 1 linha em `checklist_step_emails` + fan-out/âncora nas threads
 *  dela — usado tanto pelo caminho de hoje (1 linha, `sendStepEmail`
 *  colapsado) quanto por cada linha extra de um envio multi-idioma. */
async function insertEmailRow(
  admin: Admin,
  params: {
    owner: StepOwner;
    stepId: string;
    senderId: string;
    subject: string;
    body: string;
    language: EmailLanguage;
    recipients: StepEmailRecipient[];
    threadId: string;
    inReplyTo: string | undefined;
    fanoutThreads: ResolvedThread[];
  }
): Promise<{ ok: true; sent: number; failed: number } | { ok: false; error: string }> {
  const ownerFields =
    params.owner.kind === "order"
      ? { checklist_step_id: params.stepId, pre_loading_step_id: null }
      : { checklist_step_id: null, pre_loading_step_id: params.stepId };

  const sent = params.recipients.filter((r) => r.ok).length;
  const failed = params.recipients.length - sent;
  const rowMessageId = params.recipients.find((r) => r.ok && r.message_id)?.message_id ?? null;
  const status: "success" | "partial" | "failed" =
    params.recipients.length === 0
      ? "failed"
      : sent === params.recipients.length
        ? "success"
        : sent === 0
          ? "failed"
          : "partial";

  const emailRowId = randomUUID();
  const { error } = await admin.from("checklist_step_emails").insert({
    id: emailRowId,
    ...ownerFields,
    sender_id: params.senderId,
    subject: params.subject,
    body: params.body,
    recipients: params.recipients,
    status,
    language: params.language,
    thread_id: params.threadId,
    message_id: rowMessageId,
    in_reply_to_message_id: params.inReplyTo ?? null,
  });
  if (error) return { ok: false, error: error.message };

  // Fan-out + âncora. Roda mesmo se sent === 0: a linha existe de qualquer
  // forma (igual ao status "failed" já gravado), então a thread também deve
  // refletir isso — sem Message-ID ela só não vira âncora de cabeçalho.
  await recordThreadFanout(admin, params.fanoutThreads, emailRowId);
  for (const t of params.fanoutThreads) {
    await promoteAnchorIfMissing(admin, t.id, emailRowId, rowMessageId);
  }
  return { ok: true, sent, failed };
}

const withEmail = (people: Person[]): PersonWithEmail[] =>
  people.filter((p): p is PersonWithEmail => Boolean(p.email));
const missingEmail = (people: Person[]): StepEmailRecipient[] =>
  people
    .filter((p) => !p.email)
    .map((p) => ({ user_id: p.userId, name: p.name, email: "", ok: false, error: "No e-mail on file." }));

/**
 * Envio síncrono. Cada Order por trás do owner (`resolveOwnerOrders`) tem sua
 * PRÓPRIA thread (`email_threads`, chave `(order_id, kind)`); pra Order
 * (`owner.kind === "order"`) só existe 1, então nada disto muda nada. Pra
 * Pre-loading/Shipment (que consolidam N Orders, mesmo `owner.kind ===
 * "pre_loading"`) cada Order recebe sua PRÓPRIA cópia do e-mail, respondendo
 * de verdade dentro da conversa daquele Order — não mais "pegando carona" na
 * thread de um único Order escolhido como primário. Decisão do usuário em
 * 16/09/2026, vale pra QUALQUER etapa depois da fase Order (não é específico
 * de nenhuma etapa) — ver docs/regras_de_negocio.md.
 *
 * Cada destinatário "plain" (papel `client`, ou qualquer um numa etapa
 * `external` — decisão do usuário em 11/09/2026) pertence a um GRUPO DE
 * IDIOMA (via `profiles.client_id`) e recebe uma cópia em cada Order que o
 * SEU cliente de fato tem neste owner (`threadsForLanguage`); quem não é
 * "plain" fica de fora de qualquer grupo — recebe uma cópia em TODOS os
 * Orders do owner, sempre no idioma PRIMÁRIO (não é ligado a nenhum cliente
 * específico).
 *
 * **Colapsa pro caminho mais simples quando ≤1 grupo tem destinatário
 * "plain" selecionado NESTE envio** (Fase multi-idioma, 15/09/2026): 1 linha
 * em `checklist_step_emails` POR ORDER (combinando interno + o único grupo
 * ativo, ou só interno) — a esmagadora maioria dos envios (todo Order, e todo
 * PL de idioma único e 1 Order) nunca sai desse caminho. Só quando 2+ grupos
 * têm destinatário "plain" de verdade é que interno e cada grupo geram
 * mensagens/linhas separadas — de novo, uma por Order de cada um. Todos no
 * "To" dentro do próprio grupo, igual à decisão de 11/09/2026 — o "grupo" é
 * (papel, idioma), não só papel.
 *
 * Order cujo `client_id` não bate com nenhum grupo (ou é nulo) — drift do
 * `pre_loading_clients`, editado à mão — tem suas threads somadas ao grupo
 * PRIMÁRIO; grupo sem NENHUMA thread própria (drift no sentido oposto) usa
 * as threads do grupo primário também. Nenhum Order fica de fora de toda
 * mensagem-cliente, e a mensagem interna sempre atinge todos os Orders, sem
 * depender de grupo nenhum.
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
  const [profilesResult, recipientInfoById, orders] = await Promise.all([
    admin.from("profiles").select("id, full_name").in("id", recipientIds),
    loadRecipientInfoByUserId(admin, recipientIds),
    resolveOwnerOrders(admin, owner),
  ]);
  const nameById = new Map((profilesResult.data ?? []).map((p) => [p.id, p.full_name]));

  // Sem nenhum Order resolvido, não manda e-mail nenhum — nunca cai num modo
  // "sem thread" silencioso (ver lib/email/threads.ts).
  if (orders.length === 0) {
    return {
      ok: false,
      error:
        owner.kind === "order"
          ? "Could not find the order behind this step."
          : "This pre-loading has no order linked yet — cannot start an e-mail thread.",
    };
  }

  const threadsResult = await resolveThreadsForOrderIds(admin, orders, parsed.data.step);
  if (!threadsResult.ok) return { ok: false, error: threadsResult.error };
  const allThreads = threadsResult.threads; // ordenado por po_number — [0] é a PRIMÁRIA GERAL
  const overallPrimaryThread = allThreads[0];
  const threadByOrderId = new Map(allThreads.map((t) => [t.orderId, t]));
  const poNumberByOrderId = new Map(orders.map((o) => [o.id, o.po_number]));

  // Cada thread tem seu PRÓPRIO histórico citado — cada Order recebe sua
  // própria cópia do e-mail, respondendo de verdade dentro da conversa
  // daquele Order (decisão do usuário em 16/09/2026), não mais uma única
  // renderização compartilhada a partir de UMA thread "primária" geral.
  const contentByThreadId = new Map<string, Awaited<ReturnType<typeof renderStepEmailHtmls>>>();
  for (const thread of allThreads) {
    const quoted = await loadQuotedHistory(admin, thread.id);
    contentByThreadId.set(
      thread.id,
      await renderStepEmailHtmls(admin, owner, stepRow.id, session.profile.full_name, parsed.data, quoted)
    );
  }
  // `clientVariants`/`primaryLanguage` não dependem de `quoted` — idênticos
  // em qualquer entrada do map; só `internalHtml`/`clientVariants[].html`
  // variam de fato por thread (lidos via `contentByThreadId` mais abaixo).
  const { clientVariants, primaryLanguage } = contentByThreadId.get(overallPrimaryThread.id)!;

  // clientId -> idioma do grupo (pra classificar destinatário -> grupo).
  const clientIdToLanguage = new Map<string, EmailLanguage>();
  for (const variant of clientVariants) {
    for (const clientId of variant.clientIds) clientIdToLanguage.set(clientId, variant.language);
  }
  // orderId -> idioma do grupo daquele Order (via client_id do Order) — órfão
  // (client_id nulo, ou fora de todo grupo resolvido) cai no idioma primário.
  const languageForOrder = new Map<string, EmailLanguage>(
    orders.map((o) => [o.id, (o.client_id && clientIdToLanguage.get(o.client_id)) || primaryLanguage])
  );
  const threadsByLanguage = new Map<EmailLanguage, ResolvedThread[]>();
  for (const order of orders) {
    const thread = threadByOrderId.get(order.id);
    if (!thread) continue;
    const language = languageForOrder.get(order.id)!;
    const list = threadsByLanguage.get(language) ?? [];
    list.push(thread);
    threadsByLanguage.set(language, list);
  }
  // Grupo sem NENHUMA thread própria (cliente listado em `pre_loading_clients`
  // que não está de fato atrás de nenhum Order deste owner — drift no sentido
  // oposto): cai nas threads do grupo PRIMÁRIO em vez de falhar o envio; se
  // até o primário estiver órfão (drift duplo, patológico), cai em todas as
  // threads do owner — nunca em lista vazia.
  const threadsForLanguage = (language: EmailLanguage): ResolvedThread[] => {
    const own = threadsByLanguage.get(language);
    if (own?.length) return own;
    const primary = threadsByLanguage.get(primaryLanguage);
    if (primary?.length) return primary;
    return allThreads;
  };

  const isPlain = (id: string) => overallPrimaryThread.kind === "external" || recipientInfoById.get(id)?.isClient === true;
  const languageForUser = (id: string): EmailLanguage => {
    const clientId = recipientInfoById.get(id)?.clientId ?? null;
    return (clientId && clientIdToLanguage.get(clientId)) || primaryLanguage;
  };

  const people: Person[] = await Promise.all(
    recipientIds.map(async (userId) => {
      const { data } = await admin.auth.admin.getUserById(userId);
      const plain = isPlain(userId);
      return {
        userId,
        name: nameById.get(userId) ?? "—",
        email: data.user?.email ?? null,
        language: plain ? languageForUser(userId) : null,
      };
    })
  );
  // Avulso entra como qualquer outro destinatário, só sem `user_id` — sempre
  // "plain" e sempre no idioma PRIMÁRIO (sem client_id, não há como saber o
  // idioma de verdade — RN03: nunca bloqueia, cai no idioma padrão do envio).
  const knownEmails = new Set(people.map((p) => p.email?.toLowerCase()).filter(Boolean));
  for (const email of [...new Set(parsed.data.ad_hoc_emails)]) {
    if (knownEmails.has(email)) continue; // já está na lista como usuário
    people.push({ userId: null, name: email, email, language: primaryLanguage });
  }

  const threadHeadersFor = (threads: ResolvedThread[]): Promise<ThreadingHeaders> => threadingHeaders(admin, threads);
  // Gmail agrupa por Subject exato (ignorando "Re:"), não só por References —
  // pra uma cópia de Pre-loading/Shipment cair de verdade na conversa do seu
  // Order, o ENVELOPE precisa usar o assunto do PRÓPRIO Order (igual a um
  // envio direto da tela daquele Order), mesmo quando o owner só tem 1 Order.
  // O rótulo visível NO CORPO (`checklistStepEmailHtml`) continua vindo do
  // assunto digitado no compositor — só o envelope SMTP muda aqui.
  const smtpSubjectForThread = (thread: ResolvedThread, h: ThreadingHeaders): string => {
    if (owner.kind === "order") {
      return h["In-Reply-To"] && !/^re:/i.test(parsed.data.subject) ? `Re: ${parsed.data.subject}` : parsed.data.subject;
    }
    const base = `Order #${poNumberByOrderId.get(thread.orderId) ?? ""}`;
    return h["In-Reply-To"] ? `Re: ${base}` : base;
  };

  /** Manda todos os `passes` (1 por variante de HTML) pra dentro de UMA
   *  thread e grava 1 linha em `checklist_step_emails` pra ela — chamada uma
   *  vez por Order atingido neste envio (ver os 2 branches abaixo).
   *  `const`/arrow de propósito (não `function`): precisa fechar sobre o
   *  `stepRow`/`parsed.data` já NARROWED pelos guards acima — uma function
   *  declaration hoisted perde essa narrowing pro TS. */
  const deliverAndRecord = async (
    thread: ResolvedThread,
    passes: { html: string; people: Person[] }[],
    body: string,
    rowLanguage: EmailLanguage
  ): Promise<{ ok: true; sent: number; failed: number } | { ok: false; error: string }> => {
    const threadHeaders = await threadHeadersFor([thread]);
    const replyTo = replyToAddress(thread.id);
    const smtpSubject = smtpSubjectForThread(thread, threadHeaders);

    const recipients: StepEmailRecipient[] = [];
    for (const pass of passes) {
      recipients.push(...missingEmail(pass.people));
      const members = withEmail(pass.people);
      if (members.length === 0) continue;
      const sent = await sendEmail({
        to: members.map((p) => p.email),
        subject: smtpSubject,
        html: pass.html,
        replyTo,
        headers: threadHeaders,
      });
      for (const p of members) {
        recipients.push({
          user_id: p.userId,
          name: p.name,
          email: p.email,
          ok: sent.ok,
          error: sent.ok ? null : sent.error,
          message_id: sent.ok ? sent.messageId : null,
        });
      }
    }

    return insertEmailRow(admin, {
      owner,
      stepId: stepRow.id,
      senderId: session.userId,
      subject: parsed.data.subject,
      body,
      language: rowLanguage,
      recipients,
      threadId: thread.id,
      inReplyTo: threadHeaders["In-Reply-To"],
      fanoutThreads: [thread],
    });
  };

  // Quantos idiomas têm destinatário "plain" de verdade NESTE envio — só
  // acima de 1 é que vira mensagens/linhas separadas (ver doc da função).
  const activeLanguages = [...new Set(people.filter((p) => p.language).map((p) => p.language as EmailLanguage))];

  // Os grupos podem ter mudado entre abrir o compositor e clicar "Confirm &
  // send" (ex.: alguém editou os clientes do PL noutra aba, e um idioma novo
  // passou a existir) — sem isto, `renderStepEmailHtmls` cairia
  // silenciosamente pro corpo interno pra quem não tem aba, reintroduzindo
  // exatamente o swap escondido que a v4 WYSIWYG eliminou.
  for (const language of activeLanguages) {
    if (!parsed.data.bodies[language]?.trim()) {
      return {
        ok: false,
        error: "The clients on this step changed — reopen the compose box to refresh the language tabs.",
      };
    }
  }

  if (activeLanguages.length < 2) {
    // ---- ≤1 grupo de idioma ativo: 1 e-mail por Order atingido, cada um com
    // o passe interno (sempre que houver gente interna) + o passe de cliente
    // (só nos Orders que esse cliente/idioma realmente tem neste owner). ----
    const collapsedLanguage = activeLanguages[0] ?? primaryLanguage;
    const hasInternal = people.some((p) => p.language === null);
    const hasClientGroup = activeLanguages.length === 1;
    const clientThreads = hasClientGroup ? threadsForLanguage(collapsedLanguage) : [];
    const clientThreadIds = new Set(clientThreads.map((t) => t.id));
    const threadsToSend = hasInternal ? allThreads : clientThreads;

    let totalSent = 0;
    let totalFailed = 0;
    for (const thread of threadsToSend) {
      const content = contentByThreadId.get(thread.id)!;
      const includeClientPass = hasClientGroup && clientThreadIds.has(thread.id);
      const collapsedVariant = includeClientPass
        ? content.clientVariants.find((v) => v.language === collapsedLanguage)
        : undefined;
      const clientHtml = collapsedVariant?.html ?? content.internalHtml;
      const body = includeClientPass ? (collapsedVariant?.body ?? content.internalBody) : content.internalBody;
      const rowLanguage = includeClientPass ? collapsedLanguage : primaryLanguage;

      const passes: { html: string; people: Person[] }[] = [];
      if (hasInternal) passes.push({ html: content.internalHtml, people: people.filter((p) => p.language === null) });
      if (includeClientPass) {
        passes.push({ html: clientHtml, people: people.filter((p) => p.language === collapsedLanguage) });
      }

      const result = await deliverAndRecord(thread, passes, body, rowLanguage);
      if (!result.ok) return result;
      totalSent += result.sent;
      totalFailed += result.failed;
    }
    if (totalSent === 0) return { ok: false, error: "Could not deliver to any recipient." };
    return { ok: true, sent: totalSent, failed: totalFailed };
  }

  // ---- 2+ grupos ativos: 1 e-mail interno por Order (todos os Orders do
  // owner) + 1 e-mail por grupo de idioma, por Order que aquele grupo tem. ----
  let totalSent = 0;
  let totalFailed = 0;

  const internalPeople = people.filter((p) => p.language === null);
  if (internalPeople.length > 0) {
    for (const thread of allThreads) {
      const content = contentByThreadId.get(thread.id)!;
      const result = await deliverAndRecord(
        thread,
        [{ html: content.internalHtml, people: internalPeople }],
        content.internalBody,
        primaryLanguage
      );
      if (!result.ok) return result;
      totalSent += result.sent;
      totalFailed += result.failed;
    }
  }

  for (const language of activeLanguages) {
    const groupPeople = people.filter((p) => p.language === language);
    if (groupPeople.length === 0) continue;

    for (const thread of threadsForLanguage(language)) {
      const content = contentByThreadId.get(thread.id)!;
      const variant = content.clientVariants.find((v) => v.language === language);
      if (!variant) continue;

      const result = await deliverAndRecord(thread, [{ html: variant.html, people: groupPeople }], variant.body, language);
      if (!result.ok) return result;
      totalSent += result.sent;
      totalFailed += result.failed;
    }
  }

  if (totalSent === 0) return { ok: false, error: "Could not deliver to any recipient." };
  return { ok: true, sent: totalSent, failed: totalFailed };
}
