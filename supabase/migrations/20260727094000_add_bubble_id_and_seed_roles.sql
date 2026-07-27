-- =============================================================================
-- Migração de dados Bubble → Supabase: infraestrutura
--   1) bubble_id text (id ORIGINAL do registro no Bubble) em cada tabela de
--      negócio, com índice único parcial. Serve para: resolução de FK durante
--      o import, upsert idempotente (re-rodar sem duplicar) e auditoria/sync.
--   2) Seed dos papéis do RBAC simplificado: admin / user.
--
-- Não recebe bubble_id: roles (seed fixo), activity_logs (sem origem no Bubble),
-- e as junções puras (city_pols, category_factories, agent_contacts,
-- carrier_agents, pre_loading_clients, pre_loading_batches) — resolvidas pelo
-- par de FKs, não por id próprio.
-- =============================================================================

-- ---------- bubble_id ----------
alter table public.profiles                    add column bubble_id text;
alter table public.countries                   add column bubble_id text;
alter table public.pols                         add column bubble_id text;
alter table public.pods                         add column bubble_id text;
alter table public.cities                       add column bubble_id text;
alter table public.factories                    add column bubble_id text;
alter table public.categories                   add column bubble_id text;
alter table public.contacts                     add column bubble_id text;
alter table public.agents                       add column bubble_id text;
alter table public.carriers                     add column bubble_id text;
alter table public.clients                      add column bubble_id text;
alter table public.exporters                    add column bubble_id text;
alter table public.business_units               add column bubble_id text;
alter table public.order_types                  add column bubble_id text;
alter table public.shipment_models              add column bubble_id text;
alter table public.orders                       add column bubble_id text;
alter table public.batches                      add column bubble_id text;
alter table public.order_factory_category       add column bubble_id text;
alter table public.etd_info                     add column bubble_id text;
alter table public.etd_history                  add column bubble_id text;
alter table public.order_checklist_steps        add column bubble_id text;
alter table public.step_attachments             add column bubble_id text;
alter table public.pre_loadings                 add column bubble_id text;
alter table public.pre_loading_checklist_steps  add column bubble_id text;
alter table public.shipments                    add column bubble_id text;

create unique index idx_profiles_bubble_id                   on public.profiles(bubble_id)                   where bubble_id is not null;
create unique index idx_countries_bubble_id                  on public.countries(bubble_id)                  where bubble_id is not null;
create unique index idx_pols_bubble_id                       on public.pols(bubble_id)                       where bubble_id is not null;
create unique index idx_pods_bubble_id                       on public.pods(bubble_id)                       where bubble_id is not null;
create unique index idx_cities_bubble_id                     on public.cities(bubble_id)                     where bubble_id is not null;
create unique index idx_factories_bubble_id                  on public.factories(bubble_id)                  where bubble_id is not null;
create unique index idx_categories_bubble_id                 on public.categories(bubble_id)                 where bubble_id is not null;
create unique index idx_contacts_bubble_id                   on public.contacts(bubble_id)                   where bubble_id is not null;
create unique index idx_agents_bubble_id                     on public.agents(bubble_id)                     where bubble_id is not null;
create unique index idx_carriers_bubble_id                   on public.carriers(bubble_id)                   where bubble_id is not null;
create unique index idx_clients_bubble_id                    on public.clients(bubble_id)                    where bubble_id is not null;
create unique index idx_exporters_bubble_id                  on public.exporters(bubble_id)                  where bubble_id is not null;
create unique index idx_business_units_bubble_id             on public.business_units(bubble_id)             where bubble_id is not null;
create unique index idx_order_types_bubble_id                on public.order_types(bubble_id)                where bubble_id is not null;
create unique index idx_shipment_models_bubble_id            on public.shipment_models(bubble_id)            where bubble_id is not null;
create unique index idx_orders_bubble_id                     on public.orders(bubble_id)                     where bubble_id is not null;
create unique index idx_batches_bubble_id                    on public.batches(bubble_id)                    where bubble_id is not null;
create unique index idx_ofc_bubble_id                        on public.order_factory_category(bubble_id)     where bubble_id is not null;
create unique index idx_etd_info_bubble_id                   on public.etd_info(bubble_id)                   where bubble_id is not null;
create unique index idx_etd_history_bubble_id                on public.etd_history(bubble_id)                where bubble_id is not null;
create unique index idx_ocs_bubble_id                        on public.order_checklist_steps(bubble_id)      where bubble_id is not null;
create unique index idx_step_attachments_bubble_id           on public.step_attachments(bubble_id)           where bubble_id is not null;
create unique index idx_pre_loadings_bubble_id               on public.pre_loadings(bubble_id)               where bubble_id is not null;
create unique index idx_plcs_bubble_id                       on public.pre_loading_checklist_steps(bubble_id) where bubble_id is not null;
create unique index idx_shipments_bubble_id                  on public.shipments(bubble_id)                  where bubble_id is not null;

-- ---------- Seed dos papéis (RBAC simplificado: admin / user) ----------
insert into public.roles (name) values ('admin'), ('user')
  on conflict (name) do nothing;
