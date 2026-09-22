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
  resolveOwnerThreads,
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
  /** Nome do cliente da thread que esta linha atingiu (via `thread_id` →
   *  `email_threads.client_id`) — só não-nulo pra owner Pre-loading/Shipment
   *  cuja thread é `external` dividida por cliente (Order já é 1:1, sem
   *  ambiguidade nenhuma; thread `internal` de Pre-loading/Shipment não é
   *  dividida por cliente, nada a desambiguar). */
  thread_client_name: string | null;
};

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Destinatários selecionáveis — só papel `client`, ativos, não ocultos.
 * Este e-mail (qualquer etapa, Order/Pre-loading/Shipment) é comunicação
 * COM O CLIENTE; equipe interna nunca deve aparecer aqui como destinatário
 * (decisão do usuário, 16/09/2026). Quem precisa ser avisado internamente
 * usa o módulo de mensagens (`loadPeople` em `lib/messages-actions.ts`),
 * critério independente de propósito — não há razão pra acoplar os dois.
 */
export async function loadStepRecipientOptions(scopeClientId: string | null = null): Promise<Option[]> {
  await requireInternal();
  const admin = createAdminClient();
  const { data: clientRole } = await admin.from("roles").select("id").eq("name", "client").maybeSingle();
  if (!clientRole) return [];

  // Aba por cliente de Pre-loading/Shipment (22/09/2026): a equipe volta a
  // ser selecionável (Responsible/Signed by da etapa vêm pré-preenchidos),
  // mais os contatos SÓ daquele cliente — contato de outro cliente nunca
  // aparece na aba, é a conversa separada que a aba existe pra garantir.
  if (scopeClientId) {
    const data = await fetchAll<{ id: string; full_name: string; role_id: string; client_id: string | null }>(
      (from, to) =>
        admin
          .from("profiles")
          .select("id, full_name, role_id, client_id")
          .eq("status", "active")
          .eq("hidden", false)
          .order("full_name")
          .range(from, to)
    );
    return data
      .filter((p) => p.full_name.trim())
      .filter((p) => p.role_id !== clientRole.id || p.client_id === scopeClientId)
      .map((p) => ({ id: p.id, name: p.full_name }));
  }

  const data = await fetchAll<{ id: string; full_name: string }>((from, to) =>
    admin
      .from("profiles")
      .select("id, full_name")
      .eq("status", "active")
      .eq("hidden", false)
      .eq("role_id", clientRole.id)
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

/** Cliente(s) por trás do owner — pelas Order(s) DE VERDADE que ele consolida
 *  (`resolveOwnerOrders`, mesma fonte usada em `sendStepEmail` pra resolver
 *  as threads e a coluna "Client" da tabela de lotes do PL), não mais
 *  `pre_loading_clients`. Aquela tabela é editada à mão no modal Create/Edit
 *  Pre-loading e podia divergir de quais Orders o PL realmente tem hoje —
 *  esse drift fazia esta função enxergar só 1 cliente quando havia 2+ de
 *  verdade, o que travava `resolveClientLanguageGroups` em modo "nome único":
 *  o rascunho já saía com o nome ERRADO gravado por igual pra todas (sem
 *  sobrar um colchete `[Customer Name]` pra `applyCustomerName` trocar
 *  depois), em vez de ficar em branco pra cada thread corrigir na hora do
 *  envio. Bug reportado pelo usuário em 17/09/2026 (PL consolidando AGK +
 *  Nacional - MG mandou "AGK" pras duas). */
async function loadOwnerClientIds(admin: Admin, owner: StepOwner): Promise<string[]> {
  const orders = await resolveOwnerOrders(admin, owner);
  return [...new Set(orders.map((o) => o.client_id).filter((id): id is string => Boolean(id)))];
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
 * `groups[0]` é sempre o grupo PRIMÁRIO: absorve Orders órfãs (cujo
 * `client_id` não tem `clients` correspondente — cadastro removido/soft-
 * deleted; `loadOwnerClientIds` já garante que o `client_id` de toda Order do
 * owner entra aqui, então não sobra mais drift de `pre_loading_clients` pra
 * causar isso) e é o idioma que a equipe interna sempre recebe (efeito já
 * aceito desde o fix WYSIWYG, `284f20a`). Desempate determinístico por nome
 * do cliente — antes disto dependia da ordem arbitrária que o Postgres
 * devolvesse pro `.in(id, clientIds)`, inofensivo enquanto só decidia 1
 * idioma pra tudo; agora decide também quem absorve órfãs, então ganhou um
 * critério explícito.
 */
async function resolveClientLanguageGroups(
  admin: Admin,
  owner: StepOwner,
  scopeClientId: string | null = null
): Promise<ClientLanguageGroup[]> {
  // Aba por cliente: só o cliente da aba conta — 1 grupo, 1 idioma, nome dele.
  const clientIds = (await loadOwnerClientIds(admin, owner)).filter((id) => !scopeClientId || id === scopeClientId);
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
 * preview (`previewStepEmail`), pra nunca divergirem. `groups` vem sempre das
 * Order(s) DE VERDADE do owner (`loadOwnerClientIds`), não depende da etapa
 * já ter linha própria; só `facts` (campos DESTA etapa) cai vazio com
 * `stepId` nulo (Pre-loading/Shipment cuja etapa nunca foi tocada) — mesmo
 * estado que `sendStepEmail` produziria ao criar a linha na hora
 * (`ensureStepId`), antes de gravar nada nela.
 *
 * WYSIWYG desde 15/09/2026 (`284f20a`): cada variante usa o texto que está
 * na sua ABA do compositor (`input.bodies[group.language]`) — sem swap
 * escondido. A variante INTERNA usa sempre a aba do idioma PRIMÁRIO
 * (`groups[0]`) — mesmo efeito colateral já aceito quando só existe 1
 * idioma. `quoted`/`facts`/`actionUrl` continuam resolvidos uma vez só, a
 * partir da thread primária GERAL — simplificação já existente (o rodapé
 * citado de um PL multi-Order já só olhava pra 1 thread), mantida de
 * propósito: não é o bug reportado.
 *
 * `customerNameOverride` (16/09/2026, gatilho corrigido em 17/09/2026,
 * generalizado de "por Order" pra "por thread" em 22/09/2026): quando o owner
 * consolida 2+ clientes DE VERDADE no total — mesmo em grupos de idioma
 * DIFERENTES, não só quando colidem no mesmo idioma — o rascunho de TODA aba
 * fica com "[Customer Name]" literal na saudação (`loadStepEmailDefaults`
 * deixa de resolver de propósito) — aqui, chamada 1x POR THREAD
 * (`sendStepEmail`), o token é trocado pelo nome do cliente DAQUELA thread
 * (`customerNameForThread`: pra Order é sempre a Order, sem ambiguidade; pra
 * Pre-loading/Shipment é o cliente da thread `external`, ou `null` — sem
 * substituição — na thread `internal`, que não é mais dividida por cliente
 * nenhum). Decisão explícita do usuário: não precisa aparecer certo na caixa
 * de composição (a UI pode continuar mostrando o colchete/nome combinado), só
 * o e-mail que cada thread recebe precisa ser certo — é o único ponto aceito
 * de "tela mostra X, envia Y" neste arquivo, então NÃO generalizar pra mais
 * nada sem perguntar de novo (ver [[feedback-wysiwyg-no-hidden-swaps]]). Se o
 * usuário já apagou/reescreveu o colchete à mão, não sobra nada a trocar —
 * continua WYSIWYG pro resto do texto.
 */
async function renderStepEmailHtmls(
  admin: Admin,
  owner: StepOwner,
  stepId: string | null,
  senderName: string,
  input: { subject: string; bodies: Partial<Record<EmailLanguage, string>>; recordPath: string; step: ChecklistStep },
  quoted: QuotedMessage[],
  customerNameOverride: string | null = null,
  scopeClientId: string | null = null
): Promise<{
  internalHtml: string;
  internalBody: string;
  clientVariants: RenderedClientVariant[];
  primaryLanguage: EmailLanguage;
}> {
  const [facts, groups, origin] = await Promise.all([
    stepId ? loadStepFacts(admin, owner, stepId) : Promise.resolve(EMPTY_FACTS),
    resolveClientLanguageGroups(admin, owner, scopeClientId),
    currentOrigin(),
  ]);
  const primaryLanguage = groups[0].language;
  const actionUrl = origin ? `${origin}${input.recordPath}` : null;
  const logoUrl = origin ? `${origin}/logo-sotwise.svg` : null;
  // Assunto é fixo por pedido ("Order #1637") pra a caixa de entrada agrupar
  // a conversa — a etapa, que antes ia no assunto, vai em destaque no corpo.
  const stepLabel = STEP_LABELS[input.step];

  const applyCustomerName = (text: string): string =>
    customerNameOverride ? text.replace("[Customer Name]", customerNameOverride) : text;

  const fallbackBody = Object.values(input.bodies).find((b): b is string => Boolean(b?.trim())) ?? "";
  const rawInternalBody = input.bodies[primaryLanguage]?.trim() ? input.bodies[primaryLanguage]! : fallbackBody;
  const internalBody = applyCustomerName(rawInternalBody);

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
    const body = applyCustomerName(
      input.bodies[group.language]?.trim() ? input.bodies[group.language]! : rawInternalBody
    );
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

  // Nome do cliente que cada thread atingiu de verdade — só vale a query pra
  // owner Pre-loading/Shipment (Order já é 1:1, sem ambiguidade nenhuma).
  // Thread `internal` (client_id null) não entra aqui — nada a desambiguar,
  // é a conversa única do owner inteiro.
  const clientNameByThreadId = new Map<string, string>();
  if (owner.kind !== "order") {
    const threadIds = [...new Set(rows.map((r) => r.thread_id).filter((id): id is string => Boolean(id)))];
    if (threadIds.length > 0) {
      const { data: threadRows } = await admin
        .from("email_threads")
        .select("id, client_id")
        .in("id", threadIds)
        .not("client_id", "is", null);
      const clientIds = [...new Set((threadRows ?? []).map((t) => t.client_id).filter((id): id is string => Boolean(id)))];
      const { data: clientsData } = clientIds.length
        ? await admin.from("clients").select("id, name").in("id", clientIds)
        : { data: [] as { id: string; name: string }[] };
      const nameByClientId = new Map((clientsData ?? []).map((c) => [c.id, c.name]));
      for (const t of threadRows ?? []) {
        const name = t.client_id ? nameByClientId.get(t.client_id) : undefined;
        if (name) clientNameByThreadId.set(t.id, name);
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
    thread_client_name: r.thread_id ? (clientNameByThreadId.get(r.thread_id) ?? null) : null,
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
  /** Cliente da ABA do compositor (Pre-loading/Shipment, 22/09/2026) — o
   *  envio vai só pra conversa própria desse cliente (`resolveOwnerThreads`),
   *  no idioma e com o nome dele. `null` = modo antigo (Order, ou PL sem
   *  cliente identificado). */
  client_id: z.uuid().nullable().default(null),
});

export type SendStepEmailInput = z.input<typeof sendSchema>;

export type StepEmailLanguageGroup = { language: EmailLanguage; customerName: string | null };
export type StepEmailClientTab = { id: string; name: string };
export type StepEmailDefaults = {
  senderName: string;
  groups: StepEmailLanguageGroup[];
  /** Clientes do Pre-loading/Shipment, 1 aba cada (ordem por nome) — vazio
   *  pra Order (nunca tem aba). */
  clients: StepEmailClientTab[];
  /** Responsible + Signed by da etapa — pré-preenchidos no "To" de cada aba
   *  de cliente. Vazio pra Order (lá a lista só tem clientes, decisão de
   *  16/09/2026, e a equipe não é selecionável). */
  defaultRecipientIds: string[];
};

/** Clientes DE VERDADE do owner (pelas Orders consolidadas), ordenados por
 *  nome — mesma fonte das threads e dos grupos de idioma. */
async function loadOwnerClients(admin: Admin, owner: StepOwner): Promise<StepEmailClientTab[]> {
  const clientIds = await loadOwnerClientIds(admin, owner);
  if (clientIds.length === 0) return [];
  const { data } = await admin.from("clients").select("id, name").in("id", clientIds);
  return [...(data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
}

/** Guard do `client_id` da aba: só vale pra Pre-loading/Shipment e só pra um
 *  cliente que o owner de fato consolida AGORA. */
async function checkScopeClient(admin: Admin, owner: StepOwner, scopeClientId: string | null): Promise<string | null> {
  if (!scopeClientId) return null;
  if (owner.kind !== "pre_loading") return "Client tabs only exist on Pre-loading/Shipment.";
  const clientIds = await loadOwnerClientIds(admin, owner);
  if (!clientIds.includes(scopeClientId)) {
    return "The clients on this record changed — reopen the compose box to refresh the tabs.";
  }
  return null;
}

/**
 * Nome de quem está compondo agora + um grupo por idioma que a etapa resolve
 * (cliente(s) + idioma de cada) — pro compositor (a) abrir uma aba por
 * idioma, cada uma pré-populada com `buildDefaultStepBody` naquele idioma
 * (ver `lib/email/step-templates.ts`), sem depender de digitação manual, e
 * (b) só mostrar abas quando `groups.length > 1` (Fase multi-idioma,
 * 15/09/2026 — antes disto devolvia um único `{customerName, language}`,
 * sempre "o primeiro cliente que resolver").
 */
export async function loadStepEmailDefaults(
  owner: StepOwner,
  scopeClientId: string | null = null
): Promise<StepEmailDefaults> {
  const session = await requireInternal();
  const admin = createAdminClient();
  const [groups, clients, defaultRecipientIds] = await Promise.all([
    resolveClientLanguageGroups(admin, owner, scopeClientId),
    owner.kind === "pre_loading" ? loadOwnerClients(admin, owner) : Promise.resolve([]),
    loadStepTeamIds(admin, owner),
  ]);
  // Owner com 2+ clientes DE VERDADE no total (somando TODOS os grupos, não só
  // o de cada aba) — não só "2+ clientes NO MESMO grupo de idioma". Bug
  // reportado pelo usuário em 17/09/2026: um PL com AGK (pt-BR) + Nacional -
  // MG (zh) tem 1 cliente por aba (sem ambiguidade DENTRO de cada uma), então
  // a versão antiga desta conta (por grupo) resolvia e gravava "AGK" de
  // verdade na aba pt-BR — só que a variante INTERNA (`renderStepEmailHtmls`)
  // reusa a aba do idioma PRIMÁRIO pra TODA Order do owner, inclusive as de
  // outro grupo/cliente, contando com `applyOrderClientName` pra corrigir o
  // nome na hora do envio — o que só funciona se sobrar um colchete
  // `[Customer Name]` pra trocar. Com o nome já resolvido pra "AGK" (sem
  // colchete nenhum), a Order da Nacional - MG recebia "AGK" tanto faz.
  // Contar o owner inteiro faz a aba pt-BR também ficar com o colchete
  // literal quando existe QUALQUER outro cliente em QUALQUER outro grupo —
  // preserva o comportamento de hoje (nome já preenchido) só quando o owner
  // é de fato 1 cliente só (a esmagadora maioria: toda Order, e todo PL/
  // Shipment de 1 cliente).
  const totalClientCount = groups.reduce((n, g) => n + g.clientIds.length, 0);
  return {
    senderName: session.profile.full_name,
    groups: groups.map((g) => ({
      language: g.language,
      customerName: totalClientCount > 1 ? null : g.customerName,
    })),
    clients,
    defaultRecipientIds,
  };
}

/** Responsible + Signed by da etapa de Pre-loading/Shipment (sem duplicar
 *  quando é a mesma pessoa). Order devolve vazio — ver `StepEmailDefaults`. */
async function loadStepTeamIds(admin: Admin, owner: StepOwner): Promise<string[]> {
  if (owner.kind !== "pre_loading") return [];
  const { data } = await admin
    .from("pre_loading_checklist_steps")
    .select("responsible_id, signed_by_id")
    .eq("pre_loading_id", owner.preLoadingId)
    .eq("step", owner.step)
    .maybeSingle();
  if (!data) return [];
  return [...new Set([data.responsible_id, data.signed_by_id].filter((id): id is string => Boolean(id)))];
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

  const scopeClientId = parsed.data.client_id;
  const scopeError = await checkScopeClient(admin, owner, scopeClientId);
  if (scopeError) return { ok: false, error: scopeError };

  const recipientIds = [...new Set(parsed.data.recipient_ids)];
  const adHocEmails = [...new Set(parsed.data.ad_hoc_emails)];
  const [stepId, recipientInfoById, quoted] = await Promise.all([
    findStepId(admin, owner),
    loadRecipientInfoByUserId(admin, recipientIds),
    peekQuotedHistory(admin, owner, parsed.data.step, scopeClientId),
  ]);
  const { internalHtml, clientVariants, primaryLanguage } = await renderStepEmailHtmls(
    admin,
    owner,
    stepId,
    session.profile.full_name,
    parsed.data,
    quoted,
    null,
    scopeClientId
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
 * Envio síncrono. Cada owner (`resolveOwnerOrders`) tem sua(s) PRÓPRIA(S)
 * thread(s) (`resolveOwnerThreads`): Order sempre 1 (só tem 1 cliente, nada a
 * dividir); Pre-loading/Shipment (`owner.kind === "pre_loading"`) tem 1
 * thread pro `kind` `internal` (equipe inteira, não é client-scoped) e 1 POR
 * CLIENTE distinto consolidado pro `kind` `external` (nunca funde 2 clientes
 * reais na mesma conversa). Decisão do usuário em 22/09/2026 — supera o
 * fan-out por Order de 16/09/2026 (PL/Shipment deixou de "pegar carona" em
 * Order nenhuma) — ver docs/regras_de_negocio.md.
 *
 * Cada destinatário "plain" (papel `client`, ou qualquer um numa etapa
 * `external` — decisão do usuário em 11/09/2026) pertence a um GRUPO DE
 * IDIOMA (via `profiles.client_id`, `resolveClientLanguageGroups`) — isso
 * decide só qual HTML/idioma ele recebe; QUAL THREAD é outra conta agora,
 * client_id cru já resolvido em `allThreads` (`threadByClientId`), nunca mais
 * via idioma. Quem não é "plain" fica de fora de qualquer grupo — recebe uma
 * cópia em TODAS as threads do owner, sempre no idioma PRIMÁRIO (não é ligado
 * a nenhum cliente específico).
 *
 * **Colapsa pro caminho mais simples quando ≤1 grupo tem destinatário
 * "plain" selecionado NESTE envio** (Fase multi-idioma, 15/09/2026): 1 linha
 * em `checklist_step_emails` POR THREAD atingida (combinando interno + o
 * único grupo ativo, ou só interno) — a esmagadora maioria dos envios (todo
 * Order, e todo PL `internal`, que é 100% do tráfego hoje) nunca sai desse
 * caminho. Só quando 2+ grupos têm destinatário "plain" de verdade (só
 * possível numa thread `external` que consolida 2+ clientes) é que interno e
 * cada grupo geram mensagens/linhas separadas. Todos no "To" dentro do
 * próprio grupo, igual à decisão de 11/09/2026 — o "grupo" é (papel, idioma),
 * não só papel.
 *
 * Recipiente `external` cujo `client_id` não bate com NENHUM cliente que o
 * owner de fato consolida agora (estado mudou entre abrir o compositor e
 * mandar) é REJEITADO com erro — nunca cai silenciosamente numa thread
 * errada, que é exatamente o vazamento entre clientes que este modelo existe
 * pra evitar (guard logo antes de montar `people`).
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

  const scopeClientId = parsed.data.client_id;
  const scopeError = await checkScopeClient(admin, owner, scopeClientId);
  if (scopeError) return { ok: false, error: scopeError };

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

  const kind = threadKindForStep(parsed.data.step);
  // Aba de cliente: contato de OUTRO cliente nunca entra nesta conversa (a
  // lista da aba já não oferece, isto é o guard do servidor).
  if (scopeClientId) {
    for (const id of recipientIds) {
      const info = recipientInfoById.get(id);
      if (info?.isClient && info.clientId !== scopeClientId) {
        return { ok: false, error: "A recipient belongs to another client — remove them from this tab." };
      }
    }
  }

  const threadsResult = await resolveOwnerThreads(admin, owner, orders, kind, scopeClientId);
  if (!threadsResult.ok) return { ok: false, error: threadsResult.error };
  const allThreads = threadsResult.threads;
  const threadByClientId = new Map(allThreads.map((t) => [t.clientId, t] as const));

  // Nome do cliente da thread, pra "[Customer Name]" no corpo (ver
  // `customerNameOverride` em `renderStepEmailHtmls`) — pra Order é sempre a
  // SUA própria (nunca ambíguo); pra Pre-loading/Shipment é o cliente da
  // thread `external` daquela cópia especificamente, ou `null` (sem
  // substituição) na thread `internal`, que não é mais dividida por cliente.
  const orderClientIds = [...new Set(orders.map((o) => o.client_id).filter((id): id is string => Boolean(id)))];
  const { data: orderClientsData } = orderClientIds.length
    ? await admin.from("clients").select("id, name").in("id", orderClientIds)
    : { data: [] as { id: string; name: string }[] };
  const nameByClientId = new Map((orderClientsData ?? []).map((c) => [c.id, c.name]));
  const customerNameForThread = (thread: ResolvedThread): string | null => {
    if (owner.kind === "order") {
      const clientId = orders[0]?.client_id ?? null;
      return clientId ? (nameByClientId.get(clientId) ?? null) : null;
    }
    return thread.clientId ? (nameByClientId.get(thread.clientId) ?? null) : null;
  };

  // Cada thread tem seu PRÓPRIO histórico citado.
  const contentByThreadId = new Map<string, Awaited<ReturnType<typeof renderStepEmailHtmls>>>();
  for (const thread of allThreads) {
    const quoted = await loadQuotedHistory(admin, thread.id);
    contentByThreadId.set(
      thread.id,
      await renderStepEmailHtmls(
        admin,
        owner,
        stepRow.id,
        session.profile.full_name,
        parsed.data,
        quoted,
        customerNameForThread(thread),
        scopeClientId
      )
    );
  }
  // `clientVariants`/`primaryLanguage` não dependem de `quoted` — idênticos
  // em qualquer entrada do map; só `internalHtml`/`clientVariants[].html`
  // variam de fato por thread (lidos via `contentByThreadId` mais abaixo).
  const { clientVariants, primaryLanguage } = contentByThreadId.get(allThreads[0]!.id)!;

  // clientId -> idioma do grupo (pra classificar destinatário -> grupo e
  // conteúdo).
  const clientIdToLanguage = new Map<string, EmailLanguage>();
  for (const variant of clientVariants) {
    for (const clientId of variant.clientIds) clientIdToLanguage.set(clientId, variant.language);
  }
  // Threads que um GRUPO DE IDIOMA atinge — os clientes daquele grupo, cada
  // um na SUA PRÓPRIA thread (`threadByClientId`, nunca funde 2 clientes).
  // `kind === "internal"` nunca tem o que dividir — `allThreads` já é a
  // thread única do owner.
  const threadsForLanguage = (language: EmailLanguage): ResolvedThread[] => {
    if (kind === "internal") return allThreads;
    const variant = clientVariants.find((v) => v.language === language);
    const threads = (variant?.clientIds ?? [])
      .map((id) => threadByClientId.get(id))
      .filter((t): t is ResolvedThread => Boolean(t));
    return threads.length ? threads : allThreads;
  };

  const isPlain = (id: string) => kind === "external" || recipientInfoById.get(id)?.isClient === true;
  const languageForUser = (id: string): EmailLanguage => {
    const clientId = recipientInfoById.get(id)?.clientId ?? null;
    return (clientId && clientIdToLanguage.get(clientId)) || primaryLanguage;
  };

  // Numa thread `external` (dividida por cliente), um destinatário cujo
  // `client_id` não bate com NENHUM cliente que o owner de fato consolida
  // agora precisa ser REJEITADO, não cair silenciosamente numa thread
  // errada — é o vazamento entre clientes que este modelo existe pra evitar.
  if (kind === "external") {
    for (const id of recipientIds) {
      const clientId = recipientInfoById.get(id)?.clientId ?? null;
      if (clientId && !threadByClientId.has(clientId)) {
        return {
          ok: false,
          error: "The clients on this record changed — reopen the compose box to refresh the recipient list.",
        };
      }
    }
  }

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
  // Cada thread agora é a conversa PRÓPRIA do seu owner (Order, ou o
  // Pre-loading/Shipment inteiro) — não há mais "pegar carona" no assunto de
  // outro registro, então o envelope SMTP volta a ser sempre o assunto
  // digitado no compositor (igual ao que uma Order já fazia antes desta
  // mudança), só com "Re:" quando a thread já tem âncora.
  const smtpSubjectForThread = (h: ThreadingHeaders): string =>
    h["In-Reply-To"] && !/^re:/i.test(parsed.data.subject) ? `Re: ${parsed.data.subject}` : parsed.data.subject;

  /** Manda todos os `passes` (1 por variante de HTML) pra dentro de UMA
   *  thread e grava 1 linha em `checklist_step_emails` pra ela — chamada uma
   *  vez por thread atingida neste envio (ver os 2 branches abaixo).
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
    const smtpSubject = smtpSubjectForThread(threadHeaders);

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
    // ---- ≤1 grupo de idioma ativo: 1 e-mail por thread atingida, cada uma
    // com o passe interno (sempre que houver gente interna) + o passe de
    // cliente (só nas threads desse cliente/idioma — sempre `allThreads`
    // inteiro quando `kind === "internal"`, só a(s) thread(s) daquele cliente
    // quando `external`). ----
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

  // ---- 2+ grupos ativos (só possível numa thread `external` que consolida
  // 2+ clientes): 1 e-mail interno por thread (todas as threads do owner) +
  // 1 e-mail por grupo de idioma, pelas threads (clientes) que aquele grupo
  // tem. ----
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
