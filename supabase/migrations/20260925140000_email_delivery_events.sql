-- =============================================================================
-- Entrega dos e-mails por etapa — o que o Resend avisou DEPOIS do envio.
--
-- `checklist_step_emails.recipients[].ok` só diz se o Resend ACEITOU o envio
-- (POST /emails 200). O e-mail ainda pode voltar: endereço inexistente
-- (bounce), supressão por bounce anterior, falha de entrega. Isso chega depois,
-- pelo webhook (`email.bounced` / `email.failed` / `email.suppressed` /
-- `email.complained`), e a tela precisa mostrar no chip do destinatário que o
-- e-mail não chegou (QA 25/09: vistapub@tester.com "Recipient not found").
--
-- Tabela à parte porque `checklist_step_emails` é imutável (revoke de update,
-- migration 20260909120000). Casamento pelo `message_id` do evento contra
-- `recipients[].message_id` da linha + o e-mail em `data.to`. Uma linha por
-- (e-mail × destinatário × tipo de evento): retry do webhook não duplica.
-- =============================================================================

create table public.email_delivery_events (
  id                      uuid primary key default gen_random_uuid(),
  checklist_step_email_id uuid not null references public.checklist_step_emails(id) on delete cascade,
  email                   text not null,           -- destinatário afetado, minúsculo
  event                   text not null check (event in ('bounced', 'failed', 'suppressed', 'complained')),
  reason                  text,                    -- mensagem do Resend (bounce.message / failed.reason)
  provider_email_id       text,                    -- data.email_id do Resend
  occurred_at             timestamptz not null default now(),
  created_at              timestamptz not null default now(),
  unique (checklist_step_email_id, email, event)
);

create index idx_email_delivery_events_email_row
  on public.email_delivery_events (checklist_step_email_id);

alter table public.email_delivery_events enable row level security;
-- RLS deny-all (sem policy) — acesso só via service_role atrás da DAL.
revoke update, delete on public.email_delivery_events from anon, authenticated, service_role;
