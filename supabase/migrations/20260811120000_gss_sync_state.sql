-- =============================================================================
-- Estado do pull das bibliotecas a partir do GSS (ver docs/INTEGRACAO_GSS.md).
--
-- O GSS é o DONO das 14 bibliotecas; o SOTWISE só consome, por pull agendado.
-- Uma linha por recurso guarda o cursor incremental (`watermark` = maior
-- `updated_at` já processado, medido pelo RELÓGIO DO GSS) e o resultado da última
-- execução, que é a base dos relatórios e do alerta de falha.
--
-- O puller lê `updated_at > watermark - interval '5 minutes'`: a sobreposição
-- cobre desvio de relógio e commits fora de ordem. O upsert por `gss_id` é
-- idempotente, então reprocessar linha repetida não tem efeito colateral.
--
-- Vem junto com `20260803120000_add_gss_id_to_libraries.sql` (a coluna de
-- pareamento). As duas são aditivas — nada do que já roda é afetado.
-- =============================================================================

create table public.gss_sync_state (
  resource      text primary key,   -- 'countries', 'agents', 'category_factories', …
  watermark     timestamptz,        -- null = nunca sincronizado (primeira carga)
  last_run_at   timestamptz,
  last_status   text check (last_status in ('ok', 'error')),
  last_error    text,
  rows_upserted integer not null default 0,
  rows_deleted  integer not null default 0,
  updated_at    timestamptz not null default now()
);

create trigger trg_gss_sync_state_updated_at before update on public.gss_sync_state
  for each row execute function public.set_updated_at();

alter table public.gss_sync_state enable row level security;
