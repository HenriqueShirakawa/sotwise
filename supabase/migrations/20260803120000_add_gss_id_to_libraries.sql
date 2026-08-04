-- =============================================================================
-- Espelhamento SOTWISE <-> GSS (mão dupla) das "bibliotecas" (cadastros de
-- referência). Adiciona `gss_id text` — o id ORIGINAL do registro no GSS — em
-- cada uma das 14 tabelas de biblioteca, com UNIQUE CONSTRAINT (não-parcial),
-- mesmo padrão do `bubble_id`:
--   * permite múltiplos NULL (registros ainda não pareados / nascidos no SOTWISE);
--   * habilita `ON CONFLICT (gss_id)` → upsert idempotente na sincronização.
--
-- Só as bibliotecas entram (diferente do bubble_id, que foi em todas as tabelas
-- de negócio). Colunas de sync que JÁ existem e serão reaproveitadas: `updated_at`
-- (detecção de mudança / last-write-wins) e `deleted_at` (soft-delete propagável).
-- =============================================================================

alter table public.countries        add column gss_id text;
alter table public.pols             add column gss_id text;
alter table public.pods             add column gss_id text;
alter table public.cities           add column gss_id text;
alter table public.factories        add column gss_id text;
alter table public.categories       add column gss_id text;
alter table public.contacts         add column gss_id text;
alter table public.agents           add column gss_id text;
alter table public.carriers         add column gss_id text;
alter table public.clients          add column gss_id text;
alter table public.exporters        add column gss_id text;
alter table public.business_units   add column gss_id text;
alter table public.order_types      add column gss_id text;
alter table public.shipment_models  add column gss_id text;

alter table public.countries        add constraint countries_gss_id_key        unique (gss_id);
alter table public.pols             add constraint pols_gss_id_key             unique (gss_id);
alter table public.pods             add constraint pods_gss_id_key             unique (gss_id);
alter table public.cities           add constraint cities_gss_id_key           unique (gss_id);
alter table public.factories        add constraint factories_gss_id_key        unique (gss_id);
alter table public.categories       add constraint categories_gss_id_key       unique (gss_id);
alter table public.contacts         add constraint contacts_gss_id_key         unique (gss_id);
alter table public.agents           add constraint agents_gss_id_key           unique (gss_id);
alter table public.carriers         add constraint carriers_gss_id_key         unique (gss_id);
alter table public.clients          add constraint clients_gss_id_key          unique (gss_id);
alter table public.exporters        add constraint exporters_gss_id_key        unique (gss_id);
alter table public.business_units   add constraint business_units_gss_id_key   unique (gss_id);
alter table public.order_types      add constraint order_types_gss_id_key      unique (gss_id);
alter table public.shipment_models  add constraint shipment_models_gss_id_key  unique (gss_id);
