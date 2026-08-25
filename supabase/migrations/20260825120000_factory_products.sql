-- =============================================================================
-- Produtos da fábrica (granularidade fina que o GSS expõe em `supplier-category`).
--
-- Descoberta em 25/08/2026: `/core/supplier-category/` NÃO é uma junção pura
-- Factory×Category — é uma TABELA própria (id, code, city, timestamps). A mesma
-- fábrica pode ter o mesmo par (categoria) em mais de uma linha, distinguidas
-- pelo `code` (e às vezes pela `city`): 1067 linhas para 1035 pares distintos,
-- 287 codes, 139 cidades. Ou seja: cada linha é um PRODUTO da fábrica.
--
-- Até aqui o sync colapsava isso na junção `category_factories` (só o par
-- fábrica×categoria) e jogava fora `code`/`city` + as ~32 linhas extras. Esta
-- tabela captura a granularidade perdida.
--
-- Decisão (25/08/2026): ADITIVO. `category_factories` continua existindo (o app
-- usa nos filtros de Pre-loading/Shipments); `factory_products` é a camada nova e
-- fina. A junção passa a ser um derivado do conjunto de produtos.
--
-- Fonte/sync: `scripts/sync-gss/sync-products.ts` puxa `/core/supplier-category/`
-- e faz upsert por `gss_id` (o id ORIGINAL da supplier-category no GSS), traduzindo
-- supplier→factory_id, category→category_id, city→city_id. Mesmo padrão de
-- pareamento das bibliotecas (`gss_id text unique`, múltiplos NULL permitidos para
-- produto nascido no SOTWISE).
-- =============================================================================

create table public.factory_products (
  id          uuid primary key default gen_random_uuid(),
  factory_id  uuid not null references public.factories(id)  on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  -- cidade da planta daquele produto; nullable (o GSS traz "TBC"/vazio em alguns).
  city_id     uuid references public.cities(id),
  code        text,                       -- código do produto no GSS ("A", "G1"…)
  gss_id      text unique,                -- id da supplier-category no GSS (chave do sync)
  deleted_at  timestamptz,                -- soft-delete propagável (padrão das libs)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index factory_products_factory_idx  on public.factory_products (factory_id);
create index factory_products_category_idx on public.factory_products (category_id);

create trigger trg_factory_products_updated_at before update on public.factory_products
  for each row execute function public.set_updated_at();

-- RLS deny-all, no padrão do projeto: acesso só pelo service_role atrás da DAL.
alter table public.factory_products enable row level security;
