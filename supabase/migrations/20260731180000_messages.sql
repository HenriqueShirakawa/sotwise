-- =============================================================================
-- Mensagens do time, ancoradas num registro (Order / Pre-loading / Shipment).
--
-- Regras vindas dos prints do Bubble e da conversa com o cliente:
--  * a thread pertence ao REGISTRO: quem abre o pedido enxerga todo o histórico
--    daquele pedido, tenha sido marcado ou não;
--  * fora dessa tela (o balão flutuante em qualquer lugar do sistema), o usuário
--    só vê as mensagens em que ele foi marcado no "Forward to";
--  * corpo limitado a 500 caracteres (contador 0/500 no compositor);
--  * leitura é por destinatário — a UI mostra quem já leu.
--
-- Sem exclusão: mensagem é histórico. RLS deny-all como no resto do schema
-- (todo acesso passa pelo service_role atrás da DAL).
-- =============================================================================

create type public.message_entity as enum ('order', 'pre_loading', 'shipment');

create table public.messages (
  id          uuid primary key default gen_random_uuid(),
  entity_type public.message_entity not null,
  entity_id   uuid not null,                       -- orders.id | pre_loadings.id | shipments.id
  author_id   uuid not null references public.profiles(id),
  body        text not null check (char_length(body) between 1 and 500),
  created_at  timestamptz not null default now()
);

-- A leitura da thread é sempre (tipo, registro) ordenada no tempo.
create index idx_messages_entity on public.messages (entity_type, entity_id, created_at);
create index idx_messages_author on public.messages (author_id);

-- Quem foi marcado no "Forward to". A ausência de linha = não foi notificado
-- (mas ainda vê a mensagem dentro da tela do registro).
create table public.message_recipients (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id),
  read_at    timestamptz,
  primary key (message_id, user_id)
);

-- Base do contador do balão: não lidas de um usuário.
create index idx_message_recipients_unread
  on public.message_recipients (user_id)
  where read_at is null;

alter table public.messages            enable row level security;
alter table public.message_recipients  enable row level security;
