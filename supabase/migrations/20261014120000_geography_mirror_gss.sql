-- Espelho de geografia do GSS — `countries` e `cities` (2026-10-14).
--
-- Pedido do usuário: as duas bibliotecas são consumidas da base do GSS
-- (`/core/country/` e `/core/city/`) e aqui ficam como ESPELHO. Até hoje só o
-- `name` vinha; o resto do registro deles ficava de fora.
--
-- Decisão explícita do usuário sobre as FKs da origem: **não** replicamos a
-- modelagem do GSS. `city.province` aponta para `/core/province/` lá, e
-- `city.country_name` vem por tabela — aqui as duas entram como **texto**:
--   * nada de tabela `provinces` nova;
--   * nada de `cities.country_id` → `countries` (a FK existiria, mas o espelho
--     não precisa dela e um id local a mais é mais uma tradução a manter).
-- Se um dia alguém precisar filtrar cidade por país, filtra pelo texto.
--
-- `is_active` já existe nas duas tabelas (20261013130000) e agora passa a ser
-- espelhada também: o GSS expõe o campo nos dois endpoints.
--
-- Aditiva: colunas nullable, nenhum default, nada reescrito. Quem preenche é o
-- sync (`lib/gss/sync.ts`), no FIELDS do próximo pull.

alter table public.countries add column if not exists iso_code text;
comment on column public.countries.iso_code is
  'Espelho de `iso_code` do GSS (/core/country/) — ISO 3166-1 alfa-3 (BRA, CHN).';

alter table public.cities add column if not exists province text;
alter table public.cities add column if not exists country  text;
comment on column public.cities.province is
  'Espelho de `province_name` do GSS (/core/city/) — texto, não FK: a tabela province do GSS não é replicada aqui.';
comment on column public.cities.country is
  'Espelho de `country_name` do GSS (/core/city/) — texto, não FK para `countries`, por decisão de 14/10/2026.';

-- O par (nome, província) é único na origem (8192 cidades, 0 repetições em
-- 14/10/2026) e é ele que distingue as 411 homônimas — "Santa Maria" do RS da
-- "Santa Maria" do RN. Índice para a busca por nome dentro de um estado.
create index if not exists idx_cities_province_name on public.cities(province, name);
