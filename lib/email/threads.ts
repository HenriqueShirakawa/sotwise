import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import type { StepOwner } from "@/lib/checklist-email-actions";
import { STEP_LABELS } from "@/lib/checklist";
import { threadKindForStep } from "@/lib/email/step-thread-kind";
import type { ChecklistStep, EmailThreadKind } from "@/types/database";

/**
 * Redesenho de e-mail de checklist (plano em docs/regras_de_negocio.md):
 * resolve/cria as threads (`email_threads`) que um envio de etapa deve
 * atingir, e o bookkeeping de fan-out + âncora. Helper puro (recebe o client
 * do Supabase por parâmetro), mesmo espírito de `lib/checklist-emails.ts` —
 * não é Server Action.
 *
 * Owner polimórfico (decisão do usuário, 22/09/2026): cada Order tem sua(s)
 * própria(s) thread(s) (`owner_type='order'`), e cada Pre-loading/Shipment
 * (que compartilham o mesmo checklist — `owner_type='pre_loading'`) tem a(s)
 * sua(s), independente de qualquer Order que consolide — nunca mais
 * "emprestando" a thread de um Order consolidado. Pra `kind='external'` de um
 * `pre_loading`, a thread é 1-por-CLIENTE distinto consolidado (nunca funde
 * 2 clientes reais na mesma conversa); `kind='internal'` continua 1 thread só
 * pro owner inteiro. Ver `resolveOwnerThreads`.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type OwnerOrder = {
  id: string;
  po_number: string;
  client_id: string | null;
  /** Lote(s) DESTE owner que pertencem a este Order (sufixo ".NN" de
   *  `batches.batch_number`, ordenados) — vazio pra owner Order (a etapa não
   *  é de nenhum lote específico). Normalmente 1 elemento; mais de 1 quando
   *  o mesmo Pre-loading/Shipment consolida 2 lotes do mesmo Order. Usado só
   *  em rótulo (histórico + assunto do corpo do e-mail) — nunca no envelope
   *  SMTP, que precisa ficar igual entre Orders pro Gmail agrupar (ver
   *  `smtpSubjectForThread` em lib/checklist-email-actions.ts). */
  batch_numbers: string[];
};

/**
 * Order(s) por trás da etapa que está enviando e-mail — 1 para Order, N
 * (uma por pedido consolidado) para Pre-loading/Shipment (fan-out).
 * `client_id` (Fase multi-idioma, 15/09/2026) é o que permite rotear cada
 * grupo de idioma pras threads certas em `lib/checklist-email-actions.ts` —
 * antes disso a função só devolvia `id`/`po_number`, exportada aqui pra dar
 * essa reusabilidade sem duplicar as 3 queries encadeadas
 * (`pre_loading_batches` → `batches` → `orders`).
 */
export async function resolveOwnerOrders(admin: Admin, owner: StepOwner): Promise<OwnerOrder[]> {
  if (owner.kind === "order") {
    const { data: step } = await admin
      .from("order_checklist_steps")
      .select("order_id")
      .eq("id", owner.stepId)
      .maybeSingle();
    if (!step?.order_id) return [];
    const { data: order } = await admin
      .from("orders")
      .select("id, po_number, client_id")
      .eq("id", step.order_id)
      .maybeSingle();
    return order ? [{ ...order, batch_numbers: [] }] : [];
  }

  const { data: pbRows } = await admin
    .from("pre_loading_batches")
    .select("batch_id")
    .eq("pre_loading_id", owner.preLoadingId);
  const batchIds = [...new Set((pbRows ?? []).map((r) => r.batch_id))];
  if (batchIds.length === 0) return [];

  const { data: batchRows } = await admin.from("batches").select("order_id, batch_number").in("id", batchIds);
  const orderIds = [...new Set((batchRows ?? []).map((r) => r.order_id))];
  if (orderIds.length === 0) return [];

  const batchNumbersByOrder = new Map<string, string[]>();
  for (const b of batchRows ?? []) {
    const list = batchNumbersByOrder.get(b.order_id) ?? [];
    list.push(b.batch_number);
    batchNumbersByOrder.set(b.order_id, list);
  }

  const { data: orders } = await admin.from("orders").select("id, po_number, client_id").in("id", orderIds);
  return (orders ?? []).map((o) => ({ ...o, batch_numbers: (batchNumbersByOrder.get(o.id) ?? []).sort() }));
}

/** Chave do dono de uma thread — `order` nunca divide por cliente (a Order já
 *  tem 1 cliente só); `pre_loading` divide por cliente só quando `kind` for
 *  resolvido como `external` (ver `resolveOwnerThreads`) — `clientId: null`
 *  aí é o balde "sem cliente identificado" (lotes órfãos), nunca funde 2
 *  clientes reais. */
export type ThreadOwnerKey =
  | { ownerType: "order"; ownerId: string }
  | { ownerType: "pre_loading"; ownerId: string; clientId: string | null };

async function findThreadRow(admin: Admin, key: ThreadOwnerKey, kind: EmailThreadKind) {
  const base = admin
    .from("email_threads")
    .select("id, anchor_message_id")
    .eq("owner_type", key.ownerType)
    .eq("owner_id", key.ownerId)
    .eq("kind", kind);
  const clientId = key.ownerType === "pre_loading" ? key.clientId : null;
  return clientId ? base.eq("client_id", clientId).maybeSingle() : base.is("client_id", null).maybeSingle();
}

/** Busca a thread do owner; cria se ainda não existir. Corrida (dois envios
 *  concorrentes criando a mesma thread nova) tratada reconsultando pelos 2
 *  índices únicos parciais da tabela em vez de estourar erro. Exportada:
 *  também usada por `domain/client/notifications.ts` (aviso automático de
 *  avanço de lote), pra cair na mesma conversa da Order. */
export async function findOrCreateThread(
  admin: Admin,
  key: ThreadOwnerKey,
  kind: EmailThreadKind
): Promise<{ id: string; anchorMessageId: string | null } | { error: string }> {
  const clientId = key.ownerType === "pre_loading" ? key.clientId : null;

  const { data: existing } = await findThreadRow(admin, key, kind);
  if (existing) return { id: existing.id, anchorMessageId: existing.anchor_message_id };

  const { data: inserted, error } = await admin
    .from("email_threads")
    .insert({ owner_type: key.ownerType, owner_id: key.ownerId, kind, client_id: clientId })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      const { data: retry } = await findThreadRow(admin, key, kind);
      if (retry) return { id: retry.id, anchorMessageId: retry.anchor_message_id };
    }
    return { error: error.message };
  }
  if (!inserted) return { error: "Could not create the e-mail thread." };
  return { id: inserted.id, anchorMessageId: null };
}

export type ResolvedThread = {
  id: string;
  ownerType: "order" | "pre_loading";
  ownerId: string;
  kind: EmailThreadKind;
  /** Só não-nulo pra thread `pre_loading`+`external` — 1 por cliente real
   *  distinto consolidado (`null` = balde "sem cliente identificado"). Thread
   *  de Order ou `internal` de `pre_loading`: sempre `null` aqui (não
   *  confundir com "qual é o cliente pra saudação do e-mail", que pra Order
   *  vem de `orders.client_id` direto — ver `customerNameForThread` em
   *  `lib/checklist-email-actions.ts`). */
  clientId: string | null;
  /** Message-ID do e-mail-âncora — `null` enquanto a thread ainda não teve
   *  nenhum envio com Message-ID capturado (thread nova, ou só envios de antes
   *  da Fase 2). */
  anchorMessageId: string | null;
};

/**
 * Threads que o owner deve atingir pra este envio — substitui a antiga
 * `resolveThreadsForOrderIds` (fan-out por Order, decisão de 16/09/2026,
 * superada em 22/09/2026). Recebe os Orders JÁ RESOLVIDOS (com `client_id`),
 * não ids soltos — quem chama (`sendStepEmail`) reusa o mesmo array pra
 * outras contas, sem round-trip repetido.
 *
 * - `owner.kind === "order"`: sempre exatamente 1 thread (a Order já tem 1
 *   cliente só — nada a dividir).
 * - `owner.kind === "pre_loading"`, `kind === "internal"`: sempre exatamente
 *   1 thread pro Pre-loading/Shipment inteiro — destinatário interno não é
 *   client-scoped, não há por que fragmentar a conversa da equipe.
 * - `owner.kind === "pre_loading"`, `kind === "external"`: 1 thread POR
 *   CLIENTE distinto entre os `orders` recebidos (nunca funde 2 clientes reais
 *   na mesma conversa — é o vazamento que este modelo existe pra evitar).
 *   Orders sem `client_id` caem juntas no balde `clientId: null`.
 */
export async function resolveOwnerThreads(
  admin: Admin,
  owner: StepOwner,
  orders: Pick<OwnerOrder, "id" | "client_id">[],
  kind: EmailThreadKind
): Promise<{ ok: true; threads: ResolvedThread[] } | { ok: false; error: string }> {
  const keys: ThreadOwnerKey[] =
    owner.kind === "order"
      ? [{ ownerType: "order", ownerId: orders[0]!.id }]
      : kind === "internal"
        ? [{ ownerType: "pre_loading", ownerId: owner.preLoadingId, clientId: null }]
        : [...new Set(orders.map((o) => o.client_id))]
            .sort((a, b) => (a ?? "").localeCompare(b ?? ""))
            .map((clientId) => ({ ownerType: "pre_loading" as const, ownerId: owner.preLoadingId, clientId }));

  const threads: ResolvedThread[] = [];
  for (const key of keys) {
    const found = await findOrCreateThread(admin, key, kind);
    if ("error" in found) return { ok: false, error: found.error };
    threads.push({
      id: found.id,
      ownerType: key.ownerType,
      ownerId: key.ownerId,
      kind,
      clientId: key.ownerType === "pre_loading" ? key.clientId : null,
      anchorMessageId: found.anchorMessageId,
    });
  }
  return { ok: true, threads };
}

/** Grava o fan-out — uma linha por thread atingida (ver comentário da
 *  migration 20260910120000: é só auditoria, ninguém lê esta tabela para
 *  decidir nada ainda). Desde 16/09/2026, normalmente 1 elemento só — cada
 *  e-mail físico toca exatamente a thread pra qual foi de fato entregue; a
 *  versão N:N desta tabela segue existindo pra não quebrar o schema/histórico
 *  antigo. Chamado DEPOIS do insert em `checklist_step_emails` (a FK exige
 *  que a linha já exista). */
export async function recordThreadFanout(
  admin: Admin,
  threads: ResolvedThread[],
  emailId: string
): Promise<void> {
  if (threads.length === 0) return;
  await admin
    .from("checklist_step_email_threads")
    .insert(threads.map((t) => ({ checklist_step_email_id: emailId, thread_id: t.id })));
}

/**
 * Promove o e-mail recém-inserido a âncora da thread — só se ela ainda não
 * tinha uma. UPDATE condicional, seguro contra corrida (a atualização
 * perdedora afeta 0 linhas).
 *
 * A âncora "de verdade" é a primeira linha da thread COM Message-ID (é ela
 * que os próximos `In-Reply-To` apontam). Por isso o guard é
 * `anchor_message_id is null`: uma thread que só tinha envios da Fase 1 (sem
 * Message-ID capturado) ganha como âncora o primeiro envio da Fase 2 — os
 * e-mails anteriores ficam de fora da conversa no Gmail (decisão do plano:
 * nada migrado retroativamente). Sem `messageId` (todos os destinatários
 * falharam, ou o GET do Resend não devolveu), só preenche `anchor_email_id`
 * se estava vazio — mantém o bookkeeping da Fase 1, sem fingir uma âncora.
 *
 * `emailId` nulo (aviso automático de `client_notifications` — 16/09/2026,
 * sem linha própria em `checklist_step_emails`, porque não é etapa nenhuma):
 * grava só `anchor_message_id`, nunca aponta `anchor_email_id` pra um id que
 * não existe naquela tabela.
 */
export async function promoteAnchorIfMissing(
  admin: Admin,
  threadId: string,
  emailId: string | null,
  messageId: string | null
): Promise<void> {
  if (messageId) {
    await admin
      .from("email_threads")
      .update(emailId ? { anchor_email_id: emailId, anchor_message_id: messageId } : { anchor_message_id: messageId })
      .eq("id", threadId)
      .is("anchor_message_id", null);
    return;
  }
  if (!emailId) return;
  await admin
    .from("email_threads")
    .update({ anchor_email_id: emailId })
    .eq("id", threadId)
    .is("anchor_email_id", null);
}

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

/** Endereço de resposta da THREAD — o id de `email_threads` é o token que o
 *  webhook usa pra achar a conversa de volta (ver app/api/webhooks/resend). */
export function replyToAddress(threadId: string): string {
  return `reply+${threadId}@${replyDomain()}`;
}

export type ThreadingHeaders = { "In-Reply-To"?: string; References?: string };

/**
 * Cabeçalhos RFC 5322 que fazem o e-mail chegar como RESPOSTA na caixa de
 * entrada (Gmail/Outlook/Apple Mail agrupam por eles — confirmado no spike de
 * 11/09/2026 com o Resend): `In-Reply-To` = âncora da thread primária
 * (`threads[0]`); `References` = âncoras de todas as threads recebidas (hoje
 * sempre 1, `deliverAndRecord` chama isto por thread) + o Message-ID mais
 * recente da thread primária, pra quem entrou na conversa depois da âncora
 * (ex.: cliente adicionado num envio posterior) ainda ter um elo com a
 * mensagem anterior.
 *
 * Objeto vazio quando nenhuma thread tem âncora ainda — este envio é o
 * primeiro da conversa e vira ele mesmo a âncora (`promoteAnchorIfMissing`).
 */
export async function threadingHeaders(admin: Admin, threads: ResolvedThread[]): Promise<ThreadingHeaders> {
  if (threads.length === 0) return {};
  const primary = threads[0];
  const anchors = threads.map((t) => t.anchorMessageId).filter((id): id is string => Boolean(id));
  const inReplyTo = primary.anchorMessageId ?? anchors[0];
  if (!inReplyTo) return {};

  const { data: latest } = await admin
    .from("checklist_step_emails")
    .select("message_id")
    .eq("thread_id", primary.id)
    .not("message_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const references = [...new Set([...anchors, latest?.message_id].filter((id): id is string => Boolean(id)))];
  return { "In-Reply-To": inReplyTo, References: references.join(" ") };
}

export type QuotedMessage = {
  sentAt: string;
  senderName: string;
  stepLabel: string;
  body: string;
};

/**
 * Mensagens anteriores da thread (mais recente primeiro), pra ir citadas no
 * rodapé do próximo envio — igual ao "Em <data>, <fulano> escreveu:" que o
 * Gmail/Outlook anexam num reply. Sem isto, cada reply chega mostrando só a
 * mensagem nova e, mesmo agrupado, "parece" e-mail avulso (feedback do
 * usuário em 11/09/2026). Cita TODAS as mensagens da thread (pedido do
 * usuário, mesma data) — o teto natural é o checklist (24 etapas × poucos
 * envios), e o Gmail colapsa o bloco atrás do "..." de qualquer forma.
 */
export async function loadQuotedHistory(admin: Admin, threadId: string): Promise<QuotedMessage[]> {
  const { data: rows } = await admin
    .from("checklist_step_emails")
    .select("body, sender_id, created_at, checklist_step_id, pre_loading_step_id")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false });
  if (!rows?.length) return [];

  const senderIds = [...new Set(rows.map((r) => r.sender_id))];
  const orderStepIds = rows.map((r) => r.checklist_step_id).filter((id): id is string => Boolean(id));
  const plStepIds = rows.map((r) => r.pre_loading_step_id).filter((id): id is string => Boolean(id));

  const [{ data: senders }, { data: orderSteps }, { data: plSteps }] = await Promise.all([
    admin.from("profiles").select("id, full_name").in("id", senderIds),
    orderStepIds.length
      ? admin.from("order_checklist_steps").select("id, step").in("id", orderStepIds)
      : Promise.resolve({ data: [] as { id: string; step: ChecklistStep }[] }),
    plStepIds.length
      ? admin.from("pre_loading_checklist_steps").select("id, step").in("id", plStepIds)
      : Promise.resolve({ data: [] as { id: string; step: ChecklistStep }[] }),
  ]);
  const nameById = new Map((senders ?? []).map((s) => [s.id, s.full_name]));
  const stepById = new Map<string, ChecklistStep>([
    ...(orderSteps ?? []).map((s) => [s.id, s.step] as const),
    ...(plSteps ?? []).map((s) => [s.id, s.step] as const),
  ]);

  return rows.map((r) => {
    const step = stepById.get(r.checklist_step_id ?? r.pre_loading_step_id ?? "");
    return {
      sentAt: r.created_at,
      senderName: nameById.get(r.sender_id) ?? "—",
      stepLabel: step ? STEP_LABELS[step] : "",
      body: r.body,
    };
  });
}

/**
 * Versão só-leitura de `resolveOwnerThreads` pro PREVIEW: acha UMA thread do
 * owner sem criar nada, e devolve o histórico citado que o e-mail de verdade
 * levaria. `clientId` só importa pra owner `pre_loading` + `kind='external'`
 * (thread dividida por cliente) — omitido (default `null`), olha o balde
 * "sem cliente identificado", que é o caso comum hoje (100% do tráfego é
 * `internal`, sem divisão por cliente nenhuma). Lista vazia = thread ainda
 * não existe (o envio seria o primeiro da conversa).
 */
export async function peekQuotedHistory(
  admin: Admin,
  owner: StepOwner,
  step: ChecklistStep,
  clientId: string | null = null
): Promise<QuotedMessage[]> {
  const orders = await resolveOwnerOrders(admin, owner);
  if (orders.length === 0) return [];
  const kind = threadKindForStep(step);

  const base = admin.from("email_threads").select("id").eq("kind", kind);
  const query =
    owner.kind === "order"
      ? base.eq("owner_type", "order").eq("owner_id", orders[0]!.id)
      : clientId
        ? base.eq("owner_type", "pre_loading").eq("owner_id", owner.preLoadingId).eq("client_id", clientId)
        : base.eq("owner_type", "pre_loading").eq("owner_id", owner.preLoadingId).is("client_id", null);
  const { data: thread } = await query.maybeSingle();
  return thread ? loadQuotedHistory(admin, thread.id) : [];
}
