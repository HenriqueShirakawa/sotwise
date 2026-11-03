-- Limite de tokens da SIA por usuário, por dia e por mês (2026-11-03).
--
-- Pedido do usuário: um painel central onde só o owner define quantos tokens
-- cada usuário pode gastar na SIA (copilot) por dia e por mês. Decisões:
--   * conta entrada + saída (+ cache), o que a Anthropic cobra — bate com a fatura;
--   * existe um limite PADRÃO (dia e mês) para todos, e o owner sobrescreve por
--     usuário quando quiser (null = usa o padrão; 0 = bloqueado);
--   * dia e mês no fuso de São Paulo.
--
-- Só o service role lê/escreve (RLS ligada, sem policy): a rota da SIA e a tela
-- /access/sia são server-side.

-- Consumo: uma linha por pergunta feita à SIA (soma de todas as voltas do modelo).
create table if not exists public.copilot_usage (
  id                    bigint generated always as identity primary key,
  profile_id            uuid not null references public.profiles(id) on delete cascade,
  created_at            timestamptz not null default now(),
  input_tokens          integer not null default 0,
  output_tokens         integer not null default 0,
  cache_read_tokens     integer not null default 0,
  cache_creation_tokens integer not null default 0,
  total_tokens          integer generated always as
                          (input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens) stored,
  model                 text
);

create index if not exists copilot_usage_profile_created_idx
  on public.copilot_usage (profile_id, created_at desc);

alter table public.copilot_usage enable row level security;

comment on table public.copilot_usage is
  'Tokens gastos na SIA, uma linha por pergunta. Limites em copilot_limits; tela /access/sia.';

-- Limites: linha com profile_id null = padrão de todos; com profile_id = do usuário.
-- Em cada coluna, null = herda do padrão (na linha do usuário).
create table if not exists public.copilot_limits (
  id             bigint generated always as identity primary key,
  profile_id     uuid unique references public.profiles(id) on delete cascade,
  daily_tokens   bigint check (daily_tokens >= 0),
  monthly_tokens bigint check (monthly_tokens >= 0),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles(id) on delete set null
);

-- Uma só linha de padrão.
create unique index if not exists copilot_limits_default_idx
  on public.copilot_limits ((profile_id is null)) where profile_id is null;

alter table public.copilot_limits enable row level security;

comment on table public.copilot_limits is
  'Limite de tokens da SIA: profile_id null = padrão; por usuário sobrescreve (null na coluna = herda).';

insert into public.copilot_limits (profile_id, daily_tokens, monthly_tokens)
select null, 200000, 2000000
where not exists (select 1 from public.copilot_limits where profile_id is null);

-- Consumo do dia e do mês (fuso de São Paulo) por usuário. Sem argumento = todos.
create or replace function public.copilot_usage_totals(p_profile_id uuid default null)
returns table (profile_id uuid, day_tokens bigint, month_tokens bigint)
language sql
stable
as $$
  with bounds as (
    select
      (date_trunc('day',   now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') as day_start,
      (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') as month_start
  )
  select u.profile_id,
         coalesce(sum(u.total_tokens) filter (where u.created_at >= b.day_start), 0)::bigint,
         coalesce(sum(u.total_tokens), 0)::bigint
    from public.copilot_usage u, bounds b
   where u.created_at >= b.month_start
     and (p_profile_id is null or u.profile_id = p_profile_id)
   group by u.profile_id;
$$;

revoke execute on function public.copilot_usage_totals(uuid) from public, anon, authenticated;
