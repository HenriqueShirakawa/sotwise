-- =============================================================================
-- RBAC por feature + papel `owner`.
--
-- O CATÁLOGO de features vive em código (`domain/access/features.ts`) — aqui
-- entra só a CONCESSÃO. Mesma filosofia de `domain/api/registry.ts`: as chaves
-- conhecidas são a allowlist, e linha apontando para uma key que não existe
-- mais no catálogo é simplesmente ignorada na resolução (não vira acesso).
--
-- Resolução da permissão efetiva (implementada em `lib/dal.ts`):
--   owner                          → tudo (bypass em CÓDIGO, nunca em dados;
--                                    senão um owner consegue se trancar fora
--                                    do próprio painel de acessos)
--   user_features.can_* not null   → vence sobre o papel (concede E revoga)
--   senão role_features.can_*      → padrão do papel
--   senão                          → false (fail closed, igual ao RLS deny-all)
-- =============================================================================

-- ---------- papel ----------
-- `roles.name` é unique; o do-nothing deixa a migration idempotente.
insert into public.roles (name) values ('owner')
  on conflict (name) do nothing;

-- ---------- concessão por papel ----------
create table public.role_features (
  role_id      uuid not null references public.roles(id) on delete cascade,
  feature_key  text not null,
  can_view     boolean not null default false,
  can_create   boolean not null default false,
  can_edit     boolean not null default false,
  can_delete   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (role_id, feature_key)
);
create trigger trg_role_features_updated_at before update on public.role_features
  for each row execute function public.set_updated_at();

-- ---------- exceção por usuário ----------
-- As quatro colunas são NULLABLE de propósito: `null` = herda do papel,
-- `true`/`false` = sobrepõe. Sem isso não daria para revogar de um usuário algo
-- que o papel dele concede — só conceder a mais.
create table public.user_features (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  feature_key  text not null,
  can_view     boolean,
  can_create   boolean,
  can_edit     boolean,
  can_delete   boolean,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, feature_key)
);
create trigger trg_user_features_updated_at before update on public.user_features
  for each row execute function public.set_updated_at();

-- RLS deny-all, no padrão das demais tabelas (§ migration 095000): acesso só
-- pelo service_role do servidor.
alter table public.role_features enable row level security;
alter table public.user_features enable row level security;

-- ---------- seed: espelha o comportamento de HOJE ----------
-- Antes desta migration a regra era binária: admin fazia tudo, user fazia tudo
-- menos a tela de Users e o delete de Shipment. O seed reproduz exatamente isso
-- para ninguém perder acesso no deploy; a partir daí o owner ajusta pela tela.

-- admin: acesso total, exceto a feature `access` (exclusiva do owner, que não
-- depende de linha nenhuma aqui).
insert into public.role_features (role_id, feature_key, can_view, can_create, can_edit, can_delete)
select r.id, f.key, true, true, true, true
from public.roles r
cross join (values
  ('orders'), ('etd_factories'), ('pre_loading'), ('shipments'),
  ('todo'), ('registration'), ('users')
) as f(key)
where r.name = 'admin'
on conflict (role_id, feature_key) do nothing;

-- user: opera a esteira inteira, sem Users e sem delete (hoje só admin apaga
-- shipment — `app/(dashboard)/shipments/[id]/actions.ts`).
insert into public.role_features (role_id, feature_key, can_view, can_create, can_edit, can_delete)
select r.id, f.key, true, true, true, false
from public.roles r
cross join (values
  ('orders'), ('etd_factories'), ('pre_loading'), ('shipments'),
  ('todo'), ('registration')
) as f(key)
where r.name = 'user'
on conflict (role_id, feature_key) do nothing;
