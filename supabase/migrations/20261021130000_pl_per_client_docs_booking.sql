-- Shipping Docs e Booking por cliente no PL (2026-10-21, pedido do usuário).
--
-- Um PL consolida lotes de vários clientes (os clientes = os das Orders dos
-- lotes do PL). Com mais de um cliente:
--  - Shipping Docs: cada cliente tem os próprios documentos; a etapa conclui
--    quando TODOS têm pelo menos um → `step_attachments.client_id`;
--  - Booking: cada cliente tem o próprio Booking number (o Cut-off segue um só
--    no PL); a etapa conclui quando TODOS têm → `pre_loading_client_bookings`.
-- PL de um cliente só continua como antes (anexo sem cliente, booking_number
-- na própria etapa). Documento / booking antigos, sem cliente, valem pra todos.
--
-- Só aditiva: main e dev usam o mesmo banco.

alter table public.step_attachments
  add column if not exists client_id uuid references public.clients(id) on delete set null;

create table if not exists public.pre_loading_client_bookings (
  id             uuid primary key default gen_random_uuid(),
  pre_loading_id uuid not null references public.pre_loadings(id) on delete cascade,
  client_id      uuid not null references public.clients(id) on delete cascade,
  booking_number text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint pre_loading_client_bookings_unique unique (pre_loading_id, client_id)
);

-- Só o service role lê/escreve (RLS ligada, sem policy) — a tela usa server action.
alter table public.pre_loading_client_bookings enable row level security;
