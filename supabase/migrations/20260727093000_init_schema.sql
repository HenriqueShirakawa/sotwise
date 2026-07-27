-- =============================================================================
-- Sotwise / AGK — Schema inicial (migração Bubble → Supabase)
-- Fonte de verdade: docs/regras_de_negocio.md
--
-- Notas desta fase:
--   * SEM RLS (decisão: segurança na camada de aplicação; ligar RLS depois).
--   * NÃO inclui role_permissions nem role_step_denies (RBAC granular — modelado
--     no MD mas não usado nesta fase; RBAC simplificado admin/user).
--   * NÃO inclui o trigger handle_new_user (o MD alerta que ele quebra os NOT NULL;
--     criação de profile acontece pela tela Users).
--   * Views etd_factories_view / todo_list_view ficam para a implementação.
--   * FKs seguem o MD (nullable onde o MD deixou; obrigatoriedade na aplicação).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Função compartilhada de updated_at
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.company_type   as enum ('BR', 'China');
create type public.user_status    as enum ('active', 'blocked');
create type public.agent_location as enum ('brazil', 'china');   -- "local" do agente (Agent Brazil/China)

create type public.order_status as enum (
  'in_negotiation',
  'in_production',
  'partially_shipped',
  'shipped',
  'partially_delivered',
  'delivered',
  'canceled'
);

create type public.batch_status as enum (
  'in_negotiation',
  'in_production',
  'preloading',
  'in_transit',
  'delivered',
  'canceled'
);

create type public.loading_status  as enum ('total', 'partial', 'none');
create type public.checklist_phase as enum ('order', 'preloading', 'shipment');

create type public.checklist_step as enum (
  'order',                 -- 1
  'po',                    -- 2
  'pi',                    -- 3
  'deposit_payment',       -- 4
  'packing_confirm',       -- 5
  'condition_confirm',     -- 6
  'place_the_order',       -- 7
  'etd',                   -- 8
  'balance_payment',       -- 9
  'pre_loading',           -- 10
  'consolidation_point',   -- 11
  'city',                  -- 12
  'port_of_loading',       -- 13
  'shipping_docs',         -- 14
  'agents',                -- 15
  'booking',               -- 16
  'loading_date',          -- 17
  'shipping_date',         -- 18
  'bl',                    -- 19
  'original_docs',         -- 20
  'inspection_report',     -- 21
  'eta_brazil',            -- 22
  'ata_brazil',            -- 23
  'delivered'              -- 24
);

-- ===========================================================================
-- RBAC / Auth
-- ===========================================================================
create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_roles_updated_at before update on public.roles
  for each row execute function public.set_updated_at();

create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  full_name      text not null,
  date_of_birth  date,
  role_id        uuid not null references public.roles(id),
  company        public.company_type not null,
  status         public.user_status  not null default 'active',
  hidden         boolean not null default false,   -- oculta de listagens (não bloqueia login)
  slug           text unique,                      -- manter só se houver URL amigável
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_profiles_role_id on public.profiles(role_id);
create index idx_profiles_company on public.profiles(company);
create index idx_profiles_status  on public.profiles(status);
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create table public.activity_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id),
  action      text not null,
  entity_type text,
  entity_id   uuid,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);
create index idx_activity_logs_user_created on public.activity_logs(user_id, created_at desc);

-- ===========================================================================
-- Cadastros (Registration)
-- ===========================================================================

-- Geografia -----------------------------------------------------------------
create table public.countries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_countries_updated_at before update on public.countries
  for each row execute function public.set_updated_at();

create table public.pols (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_pols_updated_at before update on public.pols
  for each row execute function public.set_updated_at();

create table public.pods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_pods_updated_at before update on public.pods
  for each row execute function public.set_updated_at();

create table public.cities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_cities_updated_at before update on public.cities
  for each row execute function public.set_updated_at();

-- Cidade agrupa POLs (M-N; validar cardinalidade no merge)
create table public.city_pols (
  city_id uuid not null references public.cities(id) on delete cascade,
  pol_id  uuid not null references public.pols(id) on delete cascade,
  primary key (city_id, pol_id)
);

-- Factories / Categories ----------------------------------------------------
create table public.factories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id)
);
create trigger trg_factories_updated_at before update on public.factories
  for each row execute function public.set_updated_at();

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id)
);
create trigger trg_categories_updated_at before update on public.categories
  for each row execute function public.set_updated_at();

-- Junção M-N Factory × Category (validar cardinalidade no merge)
create table public.category_factories (
  category_id uuid not null references public.categories(id) on delete cascade,
  factory_id  uuid not null references public.factories(id) on delete cascade,
  primary key (category_id, factory_id)
);

-- Contacts / Agents ---------------------------------------------------------
create table public.contacts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text,                            -- NULL = "N/A"
  email_na      boolean not null default false,  -- marca explícita de "N/A"
  phone_number  text not null,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id)
);
create trigger trg_contacts_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();

create table public.agents (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  country_id    uuid references public.countries(id),
  location      public.agent_location,           -- option set; base do filtro Agent Brazil/China
  email         text,
  email_na      boolean not null default false,
  phone_number  text,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id)
);
create trigger trg_agents_updated_at before update on public.agents
  for each row execute function public.set_updated_at();

-- Contatos vinculados ao agente (M-N)
create table public.agent_contacts (
  agent_id    uuid not null references public.agents(id) on delete cascade,
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  primary key (agent_id, contact_id)
);

-- Carriers ------------------------------------------------------------------
create table public.carriers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);
create trigger trg_carriers_updated_at before update on public.carriers
  for each row execute function public.set_updated_at();

-- Vínculo carrier ↔ agent (base do filtro "Carrier agent" no Pre-loading)
create table public.carrier_agents (
  carrier_id uuid not null references public.carriers(id) on delete cascade,
  agent_id   uuid not null references public.agents(id) on delete cascade,
  primary key (carrier_id, agent_id)
);

-- Clients -------------------------------------------------------------------
create table public.clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  country_id  uuid not null references public.countries(id),
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id)
);
create trigger trg_clients_updated_at before update on public.clients
  for each row execute function public.set_updated_at();

-- Exporters -----------------------------------------------------------------
create table public.exporters (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  acronym     text not null,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id)
);
create trigger trg_exporters_updated_at before update on public.exporters
  for each row execute function public.set_updated_at();

-- Business Units ------------------------------------------------------------
create table public.business_units (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  icon_path   text not null,                     -- path no bucket 'business-units'
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id)
);
create trigger trg_business_units_updated_at before update on public.business_units
  for each row execute function public.set_updated_at();

-- Order Types ---------------------------------------------------------------
create table public.order_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  icon_path   text not null,                     -- SVG no bucket 'order-types'
  color       text not null,                     -- cor da tag (hex ou token)
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id)
);
create trigger trg_order_types_updated_at before update on public.order_types
  for each row execute function public.set_updated_at();

-- Shipment Models -----------------------------------------------------------
create table public.shipment_models (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id)
);
create trigger trg_shipment_models_updated_at before update on public.shipment_models
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- Bloco transacional — Orders, lotes, checklist, ETD
-- ===========================================================================
create table public.orders (
  id                 uuid primary key default gen_random_uuid(),
  po_number          text not null unique,       -- auto-gerado, não editável
  order_type_id      uuid references public.order_types(id),
  schedule_requested date,
  asap               boolean not null default false,
  client_id          uuid references public.clients(id),
  client_reference   text,
  business_unit_id   uuid references public.business_units(id),
  requester_id       uuid references public.profiles(id),
  exporter_id        uuid references public.exporters(id),
  leader_id          uuid references public.profiles(id),
  status             public.order_status not null default 'in_negotiation',  -- rollup dos lotes
  date_po            date,
  deleted_at         timestamptz,                -- soft delete (pendência hard vs soft)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.profiles(id)
);
create trigger trg_orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

create table public.batches (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders(id) on delete cascade,
  batch_number        text not null,             -- ".NN" sequencial por pedido
  status              public.batch_status not null default 'in_negotiation',
  split_from_batch_id uuid references public.batches(id),  -- linhagem do split
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (order_id, batch_number)
);
create trigger trg_batches_updated_at before update on public.batches
  for each row execute function public.set_updated_at();

create table public.order_factory_category (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders(id) on delete cascade,
  category_id      uuid not null references public.categories(id),
  factory_id       uuid not null references public.factories(id),
  batch_id         uuid references public.batches(id),   -- mutável: migra de lote no split
  ship_requirement date not null,                        -- data especulativa/obrigatória
  loading_status   public.loading_status,                -- atribuído ao finalizar o Pre-loading
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger trg_ofc_updated_at before update on public.order_factory_category
  for each row execute function public.set_updated_at();

create table public.etd_info (
  id                        uuid primary key default gen_random_uuid(),
  order_factory_category_id uuid not null unique references public.order_factory_category(id) on delete cascade,
  remarks                   text,
  ready                     boolean not null default false,   -- "Ready Parts" na UI
  ready_date                date,     -- registrada automaticamente quando `ready` é marcado
  inspection                boolean not null default false,
  dispatch_location_id      uuid references public.factories(id),
  initial_date              date,     -- preenchido manualmente; dispara current_date
  dispatch_date             date,
  "current_date"            date,     -- = data de hoje quando initial_date é preenchido (aspas: current_date é reservado)
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create trigger trg_etd_info_updated_at before update on public.etd_info
  for each row execute function public.set_updated_at();

-- Log de alterações do ETD (History) — grava apenas o diff
create table public.etd_history (
  id             uuid primary key default gen_random_uuid(),
  etd_info_id    uuid not null references public.etd_info(id) on delete cascade,
  changed_fields jsonb not null,               -- diff: { "campo": {"from":..,"to":..} }
  changed_by     uuid references public.profiles(id),
  changed_at     timestamptz not null default now()
);

create table public.order_checklist_steps (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders(id) on delete cascade,
  step           public.checklist_step not null,
  enabled        boolean not null default true,   -- TOGGLE (só etapas opcionais vão a false)
  done           boolean not null default false,  -- derivado de completed_on
  estimated_date date,
  responsible_id uuid references public.profiles(id),
  completed_on   date,                            -- preenchido = concluída
  signed_by_id   uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (order_id, step)
);
create trigger trg_ocs_updated_at before update on public.order_checklist_steps
  for each row execute function public.set_updated_at();

-- Documentos anexados a uma etapa (Supabase Storage; guarda o path)
create table public.step_attachments (
  id                uuid primary key default gen_random_uuid(),
  checklist_step_id uuid not null references public.order_checklist_steps(id) on delete cascade,
  file_path         text not null,               -- bucket 'order-documents'
  file_name         text,
  uploaded_by       uuid references public.profiles(id),
  created_at        timestamptz not null default now()
);

-- ===========================================================================
-- Bloco Pre-loading (checklist único e contínuo 14 etapas #11–24)
-- ===========================================================================
create table public.pre_loadings (
  id                     uuid primary key default gen_random_uuid(),
  pl_number              text not null unique,        -- auto-gerado "PL - NNNN"
  created_date           date not null default current_date,
  client_reference       text not null,
  pod_id                 uuid not null references public.pods(id),
  responsible_signer_id  uuid references public.profiles(id),
  leader_id              uuid not null references public.profiles(id),
  booking_status         text,                        -- campo aberto (texto livre)
  seal_number            text,                        -- campo aberto; nº do lacre
  deleted_at             timestamptz,                 -- soft delete
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references public.profiles(id)
);
create trigger trg_pre_loadings_updated_at before update on public.pre_loadings
  for each row execute function public.set_updated_at();

-- Clientes do PL (M-N)
create table public.pre_loading_clients (
  pre_loading_id uuid not null references public.pre_loadings(id) on delete cascade,
  client_id      uuid not null references public.clients(id),
  primary key (pre_loading_id, client_id)
);

-- Lotes selecionados para o PL
create table public.pre_loading_batches (
  pre_loading_id uuid not null references public.pre_loadings(id) on delete cascade,
  batch_id       uuid not null references public.batches(id),
  primary key (pre_loading_id, batch_id)
);

-- Checklist ÚNICO (7 etapas do Pre-loading + 7 do Shipment = #11–24)
create table public.pre_loading_checklist_steps (
  id                     uuid primary key default gen_random_uuid(),
  pre_loading_id         uuid not null references public.pre_loadings(id) on delete cascade,
  step                   public.checklist_step not null,   -- #11–24
  done                   boolean not null default false,   -- derivado: completed_on IS NOT NULL
  estimated_date         date,
  responsible_id         uuid references public.profiles(id),
  completed_on           date,
  signed_by_id           uuid references public.profiles(id),
  notes                  text,                              -- texto aberto (etapa Original Docs)

  -- campos específicos por etapa
  consolidation_point_id uuid references public.factories(id),  -- Consolidation Point
  city_id                uuid references public.cities(id),     -- City
  pol_id                 uuid references public.pols(id),       -- Port of Loading
  carrier_agent_id       uuid references public.agents(id),     -- Agents
  agent_brazil_id        uuid references public.agents(id),     -- Agents
  agent_china_id         uuid references public.agents(id),     -- Agents
  contact_brazil_id      uuid references public.contacts(id),   -- Agents
  contact_china_id       uuid references public.contacts(id),   -- Agents
  booking_number         text,                                  -- Booking

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (pre_loading_id, step)
);
create trigger trg_plcs_updated_at before update on public.pre_loading_checklist_steps
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- Bloco Shipment (1:1 com Pre-loading; herda o pl_number)
-- ===========================================================================
create table public.shipments (
  id                uuid primary key default gen_random_uuid(),
  pre_loading_id    uuid not null unique references public.pre_loadings(id),  -- 1:1
  shipment_model_id uuid references public.shipment_models(id),
  carrier_id        uuid references public.carriers(id),
  container_number  text,
  status            text not null default 'in_transit',   -- 'in_transit' | 'delivered' | 'canceled'
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references public.profiles(id)
);
create trigger trg_shipments_updated_at before update on public.shipments
  for each row execute function public.set_updated_at();
