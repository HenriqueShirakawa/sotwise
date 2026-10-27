-- Log do pull de ORDERS e LOTES do GSS (2026-10-27).
--
-- O GSS virou o dono de Orders e Lotes (o SOT não cria mais nenhum dos dois).
-- Além do push deles (POST /api/orders, POST /api/batches), o cron diário
-- (app/api/cron/sync-gss) agora LÊ /orders/ e /orders/batch-totals/ do GSS e
-- cria/atualiza o que estiver diferente aqui (lib/gss/sync-orders.ts). Cada
-- registro que o cron mexeu — ou não conseguiu mexer — vira uma linha aqui; a
-- tela /access/gss/sync lista, com uma aba para Orders e outra para Lotes.
--
-- Só o que mudou é gravado (uma order igual nos dois lados não gera linha).
-- Só o service role escreve/lê (RLS ligada, sem policy): a tela é server-side,
-- owner-only.

create table if not exists public.gss_sync_log (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- agrupa as linhas de uma mesma execução do cron
  run_id     uuid not null,
  entity     text not null check (entity in ('order', 'batch')),
  -- created: nasceu aqui | updated: campo mudou | linked: só ganhou o gss_id
  -- warning: gravou, mas algo do GSS não casou aqui | error: não gravou
  action     text not null check (action in ('created', 'updated', 'linked', 'warning', 'error')),
  gss_id     text not null,
  -- referência legível: po_number da order ("1705") ou número do lote ("1705.01")
  ref        text,
  -- order do registro (o lote aponta para a order dele); sem FK — order pode ser apagada
  order_id   uuid,
  record_id  uuid,
  -- [{ field, before, after }] em texto legível (nomes, não UUIDs)
  changes    jsonb,
  message    text,
  -- cron (Vercel) ou script (máquina local)
  origin     text not null default 'cron'
);

create index if not exists gss_sync_log_created_at_idx on public.gss_sync_log (created_at desc);
create index if not exists gss_sync_log_entity_idx on public.gss_sync_log (entity, created_at desc);

alter table public.gss_sync_log enable row level security;

comment on table public.gss_sync_log is
  'O que o cron trouxe do GSS para Orders e Lotes (lib/gss/sync-orders.ts). Tela: /access/gss/sync.';
