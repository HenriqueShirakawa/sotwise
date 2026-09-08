-- =============================================================================
-- E-mail manual por etapa do checklist, com destinatários escolhidos à mão e
-- histórico. Diferente das `client_notifications` (Fase 2.1): aqui não há
-- trigger nem fila — é uma ação deliberada de um usuário interno, então o
-- envio é síncrono (server action) e a linha só existe DEPOIS da tentativa,
-- já com o resultado por destinatário carimbado em `recipients`.
--
-- Mesmo padrão de "duas origens, exatamente uma FK preenchida por linha" já
-- usado em `step_attachments` (migration 20260730150000): Order usa
-- `checklist_step_id`, Pre-loading/Shipment usam `pre_loading_step_id` (é o
-- mesmo checklist único #11–24, só exibido em duas telas).
-- =============================================================================

create table public.checklist_step_emails (
  id                  uuid primary key default gen_random_uuid(),
  checklist_step_id   uuid references public.order_checklist_steps(id) on delete cascade,
  pre_loading_step_id uuid references public.pre_loading_checklist_steps(id) on delete cascade,
  sender_id           uuid not null references public.profiles(id),
  subject             text not null,
  body                text not null,
  -- Congelado no momento do envio: nome, e-mail e resultado por destinatário —
  -- [{ "user_id", "name", "email", "ok", "error" }]. Sem isto, "quem recebeu o
  -- quê" viraria reconstrução a partir do estado atual dos perfis, que muda.
  recipients          jsonb not null default '[]',
  created_at          timestamptz not null default now(),

  constraint checklist_step_emails_one_owner check (
    (checklist_step_id is not null and pre_loading_step_id is null)
    or (checklist_step_id is null and pre_loading_step_id is not null)
  )
);

create index idx_checklist_step_emails_step
  on public.checklist_step_emails (checklist_step_id)
  where checklist_step_id is not null;

create index idx_checklist_step_emails_pl_step
  on public.checklist_step_emails (pre_loading_step_id)
  where pre_loading_step_id is not null;

-- RLS deny-all, no padrão do resto do schema: acesso só pelo service_role
-- atrás da DAL (ver `lib/dal.ts`).
alter table public.checklist_step_emails enable row level security;

comment on table public.checklist_step_emails is
  'Histórico de e-mails manuais enviados a partir de uma etapa do checklist, com destinatários escolhidos à mão.';
