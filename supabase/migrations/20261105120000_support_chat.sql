-- =============================================================================
-- Suporte do portal do cliente (bloco F do Portal v2) — 2026-11-05.
--
-- Decisões do Henrique (05/11):
--  * cada CLIENTE tem os seus representantes — usuários internos do SOT
--    marcados no cadastro do cliente (Registration > Clients);
--  * o cliente vê esses contatos na tela Suporte e fala com eles num CHAT ÚNICO
--    por cliente: todos os representantes recebem, qualquer um responde;
--  * o time interno lê e responde na tela nova "Support" (feature `support`).
--
-- Tabelas próprias, separadas de `messages` (thread por registro, só interno):
-- aqui o autor pode ser usuário externo e a thread é do CLIENTE.
-- Sem exclusão: mensagem é histórico. RLS deny-all como no resto do schema
-- (todo acesso passa pelo service_role atrás da DAL).
-- =============================================================================

-- Representantes do cliente: N usuários internos por cliente.
create table public.client_representatives (
  client_id  uuid not null references public.clients(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, user_id)
);
create index idx_client_representatives_user on public.client_representatives (user_id);

-- Mensagens do chat de suporte — uma thread por cliente.
create table public.support_messages (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients(id) on delete cascade,
  author_id  uuid not null references public.profiles(id),
  body       text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index idx_support_messages_client on public.support_messages (client_id, created_at);

-- Até onde cada pessoa leu a thread (interno ou externo). Não lida = mensagem
-- de OUTRA pessoa depois de `last_read_at` (ou qualquer uma, sem linha).
create table public.support_reads (
  client_id    uuid not null references public.clients(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (client_id, user_id)
);

alter table public.client_representatives enable row level security;
alter table public.support_messages       enable row level security;
alter table public.support_reads          enable row level security;

-- Feature nova nasce fechada (catálogo em domain/access/features.ts). O seed
-- abre para admin e user — ler e responder — para os representantes não
-- dependerem do owner ligar o toggle; o owner ajusta depois pela tela Access.
insert into public.role_features (role_id, feature_key, can_view, can_create, can_edit, can_delete)
select r.id, 'support', true, true, false, false
from public.roles r
where r.name in ('admin', 'user')
on conflict (role_id, feature_key) do nothing;
