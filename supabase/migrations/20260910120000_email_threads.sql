-- =============================================================================
-- Fase 1 do redesenho de e-mail de checklist: "thread" por Order.
--
-- Hoje cada envio de "Send email" numa etapa é uma conversa isolada (token de
-- Reply-To = id da própria linha). O objetivo final (Fase 2) é que todo envio
-- de uma Order vire, na prática, uma resposta ao primeiro e-mail já mandado
-- numa de até 2 conversas contínuas por Order — "internal" (equipe) e
-- "external" (cliente/terceiros) — mesmo que a tela continue mostrando
-- compositor/histórico por etapa, sem mudança visual nenhuma.
--
-- Esta migration só cria o esqueleto (tabelas + colunas) e é puro bookkeeping:
-- nada no app grava nelas ainda de forma que mude o comportamento de envio —
-- ver `lib/email/threads.ts` (Fase 1) e o restante do plano em
-- docs/regras_de_negocio.md.
--
-- `email_threads`: uma linha por (order_id, kind) — no máximo 2 por Order.
-- `anchor_email_id`/`anchor_message_id` gravam qual foi o PRIMEIRO e-mail da
-- conversa (o alvo de todo In-Reply-To futuro) — fica nulo até o primeiro
-- envio daquele tipo acontecer. SEM revoke de update aqui (diferente do
-- restante do schema de e-mail): a promoção do anchor é um UPDATE legítimo,
-- de metadado de bookkeeping — não é conteúdo de e-mail entregue, não precisa
-- da mesma trava de imutabilidade.
--
-- `checklist_step_email_threads`: tabela-junção N-N entre um envio
-- (`checklist_step_emails`) e as threads que ele atinge. Um envio de etapa de
-- Order só atinge 1 thread; um envio de etapa de Pre-loading/Shipment que
-- consolida N pedidos atinge as N threads correspondentes (fan-out). A linha
-- em si já grava sua thread PRIMÁRIA em `checklist_step_emails.thread_id`
-- (a do próprio pedido, ou — pra PL — a do pedido de menor po_number,
-- critério determinístico); esta tabela guarda TODAS, inclusive a primária,
-- só para auditoria/uma futura tela de "conversa completa" — o webhook de
-- resposta nunca precisa lê-la, então segue o mesmo padrão insert-only já
-- usado em `checklist_step_email_replies`.
--
-- `checklist_step_emails.thread_id/message_id/in_reply_to_message_id`: novas
-- colunas nullable — DDL passa por cima do revoke de update/delete já
-- aplicado nesta tabela (migration 20260909120000; revoke afeta DML das roles
-- do app, não ALTER TABLE rodado como dono/migração). Ficam null nesta fase;
-- só a Fase 2 (cabeçalho de verdade + Resend) as popula.
-- =============================================================================

create table public.email_threads (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders(id) on delete cascade,
  kind              text not null check (kind in ('internal', 'external')),
  anchor_email_id   uuid references public.checklist_step_emails(id),
  anchor_message_id text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (order_id, kind)
);

create trigger trg_email_threads_updated_at before update on public.email_threads
  for each row execute function public.set_updated_at();

alter table public.email_threads enable row level security;
-- RLS deny-all (sem policy), mesmo padrão do resto do schema — acesso só via
-- service_role atrás da DAL (ver lib/dal.ts).

comment on table public.email_threads is
  'Conversa contínua de e-mail por Order — no máximo 2 linhas por order_id (internal/external). anchor_* aponta pro primeiro e-mail da conversa, alvo de todo In-Reply-To futuro (Fase 2).';

create table public.checklist_step_email_threads (
  checklist_step_email_id uuid not null references public.checklist_step_emails(id) on delete cascade,
  thread_id                uuid not null references public.email_threads(id) on delete cascade,
  primary key (checklist_step_email_id, thread_id)
);

create index idx_cse_threads_thread on public.checklist_step_email_threads (thread_id);

alter table public.checklist_step_email_threads enable row level security;
-- RLS deny-all (sem policy) — acesso só via service_role atrás da DAL.

revoke update, delete on public.checklist_step_email_threads from anon, authenticated, service_role;

comment on table public.checklist_step_email_threads is
  'Fan-out: todas as threads que um envio atinge (normalmente 1; N quando a etapa é de Pre-loading/Shipment consolidando N pedidos). Insert-only, só para auditoria — a thread primária já está em checklist_step_emails.thread_id.';

alter table public.checklist_step_emails
  add column thread_id              uuid references public.email_threads(id) on delete set null,
  add column message_id             text,
  add column in_reply_to_message_id text;

create index idx_checklist_step_emails_thread
  on public.checklist_step_emails (thread_id) where thread_id is not null;

comment on column public.checklist_step_emails.thread_id is
  'Thread PRIMÁRIA deste envio (a do próprio pedido, ou a de menor po_number quando a etapa consolida vários). Nulo em e-mails de antes da Fase 1 — não migrados retroativamente.';

comment on column public.checklist_step_emails.message_id is
  'Message-ID de verdade devolvido pelo Resend após o envio (Fase 2). Nulo nesta fase.';

comment on column public.checklist_step_emails.in_reply_to_message_id is
  'Message-ID ao qual este envio respondeu (o anchor_message_id da thread primária no momento do envio). Nulo nesta fase e sempre nulo no primeiro e-mail de cada thread.';
