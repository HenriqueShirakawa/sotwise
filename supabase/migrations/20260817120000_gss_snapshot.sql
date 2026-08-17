-- =============================================================================
-- Snapshot de LEITURA do GSS, para o painel /access/gss (ver docs/INTEGRACAO_GSS.md §9.9).
--
-- Por quê: o Cloudflare do GSS desafia IPs de datacenter (a Vercel, onde o app
-- roda) com página de challenge, mesmo com o service token correto — é um fator
-- de segurança deles, que não vamos furar. Da nossa máquina (IP allowlistado) os
-- mesmos headers passam. Então em vez de o painel ler o GSS AO VIVO (do IP da
-- Vercel, que apanha), um gerador rodado de máquina allowlistada
-- (`scripts/sync-gss/snapshot.ts`) espelha aqui a resposta CRUA da API, e o
-- painel lê este espelho — o Supabase responde à Vercel normalmente.
--
-- É diagnóstico, não operação: NÃO alimenta as bibliotecas (isso é o
-- `lib/gss/sync.ts`). Guarda o payload cru por recurso + o carimbo da última
-- geração. Aditivo — nada do que já roda é afetado.
-- =============================================================================

-- Uma linha por (recurso, id do GSS). `payload` é o objeto cru que a API
-- devolveu, para o painel extrair nome/detalhe sem o schema precisar acompanhar
-- cada campo do GSS.
create table public.gss_snapshot (
  resource   text        not null,  -- chave de RECURSOS: 'city', 'customer', 'agent', …
  gss_id     bigint      not null,  -- id inteiro do registro no GSS
  payload    jsonb       not null,  -- registro cru da API do GSS
  fetched_at timestamptz not null default now(),
  primary key (resource, gss_id)
);

create index gss_snapshot_resource_idx on public.gss_snapshot (resource);

-- Resultado da última geração por recurso: dá ao painel o carimbo ("snapshot de
-- …") e o caso honesto de falha (a geração errou, mas o espelho anterior segue).
create table public.gss_snapshot_runs (
  resource   text        primary key,
  fetched_at timestamptz not null default now(),
  count      integer     not null default 0,
  ok         boolean     not null default true,
  error      text
);

-- Só o service-role (admin client do painel/script) toca estas tabelas; a
-- política deny-all vale para o resto, igual ao padrão do projeto.
alter table public.gss_snapshot enable row level security;
alter table public.gss_snapshot_runs enable row level security;
