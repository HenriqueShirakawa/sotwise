-- =============================================================================
-- Resposta do cliente por e-mail (Resend inbound) ao e-mail manual de etapa.
--
-- `checklist_step_emails` ficou imutável na migration anterior (revoke
-- update/delete) — uma resposta não pode virar UPDATE naquela linha, então
-- mora em tabela própria, insert-only, referenciando a linha original.
--
-- Matching: o `Reply-To` de todo envio de uma linha é
-- `reply+<checklist_step_emails.id>@<domínio de envio>` (ver
-- lib/checklist-email-actions.ts) — o próprio id da linha É o token, não
-- precisa de coluna nova em `checklist_step_emails`. Autenticidade não depende
-- de casar o remetente: o UUID no endereço já funciona como capability token
-- (só quem recebeu o e-mail original conhece o endereço). `from_user_id` é só
-- para exibição, resolvido por melhor esforço contra `recipients[].email` da
-- linha pai no momento em que a resposta chega.
--
-- Notificação = "mencionar todos os usuários selecionados anteriormente"
-- (pedido do cliente): uma linha por destinatário em
-- `checklist_step_email_reply_recipients`, mesmo padrão de `message_recipients`
-- (read_at nulo = não lido). Essa tabela NÃO leva o revoke de update — precisa
-- de UPDATE em `read_at` (marcar como lida), igual `message_recipients`.
-- =============================================================================

create table public.checklist_step_email_replies (
  id                      uuid primary key default gen_random_uuid(),
  checklist_step_email_id uuid not null references public.checklist_step_emails(id) on delete cascade,
  from_email              text not null,
  from_name               text,
  -- Resolvido por melhor esforço contra recipients[].email da linha pai;
  -- nulo quando a resposta veio de um endereço não reconhecido.
  from_user_id            uuid references public.profiles(id),
  subject                 text,
  -- Sempre texto puro (gerado a partir do html quando o provedor não manda
  -- text) — a UI nunca renderiza HTML de e-mail externo cru (XSS).
  body_text               text not null,
  -- Guardado só para auditoria; nunca exibido diretamente.
  body_html               text,
  -- `data.email_id` do Resend — idempotência contra retry de webhook.
  provider_message_id     text not null,
  received_at             timestamptz not null default now(),
  created_at              timestamptz not null default now()
);

create unique index checklist_step_email_replies_provider_id_key
  on public.checklist_step_email_replies (provider_message_id);

create index idx_checklist_step_email_replies_parent
  on public.checklist_step_email_replies (checklist_step_email_id);

alter table public.checklist_step_email_replies enable row level security;
-- RLS deny-all (sem policy) — acesso só via service_role atrás da DAL.

revoke update, delete on public.checklist_step_email_replies from anon, authenticated, service_role;

comment on table public.checklist_step_email_replies is
  'Respostas recebidas por e-mail (Resend inbound) a um checklist_step_emails. Insert-only, uma linha por resposta.';

create table public.checklist_step_email_reply_recipients (
  reply_id uuid not null references public.checklist_step_email_replies(id) on delete cascade,
  user_id  uuid not null references public.profiles(id),
  read_at  timestamptz,
  primary key (reply_id, user_id)
);

create index idx_checklist_step_email_reply_recipients_unread
  on public.checklist_step_email_reply_recipients (user_id) where read_at is null;

alter table public.checklist_step_email_reply_recipients enable row level security;
-- RLS deny-all (sem policy) — acesso só via service_role atrás da DAL.

comment on table public.checklist_step_email_reply_recipients is
  'Quem deve ver/ser notificado de cada resposta — o conjunto original de destinatários (recipients) + sender_id da linha pai, menos quem respondeu. read_at nulo = não lida (mesmo padrão de message_recipients).';
