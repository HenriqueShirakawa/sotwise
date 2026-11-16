-- =============================================================================
-- WeChat fase 2 — FORNECEDOR responde a ETD pelo Mini Program (小程序).
--
-- Decisões de 16/11/2026 (docs §6.17):
--  * o contato do fornecedor (a pessoa no WeChat) fica ligado à FÁBRICA, não à
--    order nem ao cliente: vincula uma vez e vê as linhas Factory×Category de
--    todas as orders daquela fábrica. Uma fábrica pode ter vários contatos; um
--    WeChat pode atender mais de uma fábrica;
--  * o fornecedor não ganha login no SOT — a "visão do fornecedor" é o próprio
--    Mini Program;
--  * o vínculo nasce de um CONVITE gerado pela equipe na tela da Factory
--    (código curto + QR do Mini Program, validade limitada, uso único).
--
-- Aditiva: nada existente muda de comportamento.
-- =============================================================================

-- OpenID da pessoa NO MINI PROGRAM (≠ OpenID da Service Account da fase 1: cada
-- conta do WeChat dá um OpenID diferente para a mesma pessoa).
create table public.factory_wechat_contacts (
  id          uuid primary key default gen_random_uuid(),
  factory_id  uuid not null references public.factories(id) on delete cascade,
  mp_openid   text not null,
  -- Preenchido quando o Mini Program estiver ligado à mesma conta da Open
  -- Platform que a Service Account (une as duas identidades). Opcional.
  unionid     text,
  -- Nome que o próprio contato digita ao se vincular (o WeChat não entrega o
  -- nome ao Mini Program sem o usuário escrever).
  name        text not null,
  is_active   boolean not null default true,
  linked_at   timestamptz not null default now(),
  invited_by  uuid references public.profiles(id) on delete set null,
  unlinked_at timestamptz,
  unlinked_by uuid references public.profiles(id) on delete set null
);

-- Um WeChat ativo por fábrica (pode estar em várias fábricas).
create unique index factory_wechat_contacts_active_key
  on public.factory_wechat_contacts (factory_id, mp_openid)
  where is_active;

create index idx_factory_wechat_contacts_openid
  on public.factory_wechat_contacts (mp_openid)
  where is_active;

-- Convite de vínculo: a equipe gera, o contato digita/escaneia no Mini Program.
create table public.factory_wechat_invites (
  id          uuid primary key default gen_random_uuid(),
  factory_id  uuid not null references public.factories(id) on delete cascade,
  -- 8 caracteres sem ambiguidade (sem 0/O/1/I); único entre os ainda válidos.
  code        text not null,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_by_contact_id uuid references public.factory_wechat_contacts(id) on delete set null
);

create unique index factory_wechat_invites_code_key
  on public.factory_wechat_invites (code)
  where used_at is null;

create index idx_factory_wechat_invites_factory
  on public.factory_wechat_invites (factory_id, created_at desc);

-- RLS deny-all, no padrão do schema: acesso só pelo service_role.
alter table public.factory_wechat_contacts enable row level security;
alter table public.factory_wechat_invites enable row level security;
