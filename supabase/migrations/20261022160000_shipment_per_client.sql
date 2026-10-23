-- BL, Original Docs e Delivered por cliente no Shipment (2026-10-22, card
-- "Ajustes Data e Logs Etapas de Order, PL e Shipment"). Mesmo molde do
-- Shipping Docs / Booking por cliente (20261021130000):
--
--  - BL (PL com 2+ clientes): cada cliente tem os próprios documentos
--    (`step_attachments.client_id`, que já existe); fecha quando TODOS têm um.
--  - Original Docs (todo PL com cliente): por cliente, documento + Tracking
--    number OU o toggle Telex release (ligado dispensa o tracking) →
--    `pre_loading_client_original_docs`. Fecha quando TODOS os clientes cumprem.
--  - Delivered (PL com 2+ clientes): uma Delivered date por cliente →
--    `pre_loading_client_delivered`. Fecha quando TODOS têm; a data do fato da
--    etapa vira a maior delas.
--
-- Etapa concluída antes de 22/10/2026 segue concluída (a etapa nunca reabre).
--
-- Só aditiva: main e dev usam o mesmo banco.

create table if not exists public.pre_loading_client_original_docs (
  id              uuid primary key default gen_random_uuid(),
  pre_loading_id  uuid not null references public.pre_loadings(id) on delete cascade,
  client_id       uuid not null references public.clients(id) on delete cascade,
  tracking_number text,
  telex_release   boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint pre_loading_client_original_docs_unique unique (pre_loading_id, client_id)
);

create table if not exists public.pre_loading_client_delivered (
  id             uuid primary key default gen_random_uuid(),
  pre_loading_id uuid not null references public.pre_loadings(id) on delete cascade,
  client_id      uuid not null references public.clients(id) on delete cascade,
  delivered_date date not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint pre_loading_client_delivered_unique unique (pre_loading_id, client_id)
);

-- Só o service role lê/escreve (RLS ligada, sem policy) — a tela usa server action.
alter table public.pre_loading_client_original_docs enable row level security;
alter table public.pre_loading_client_delivered enable row level security;
