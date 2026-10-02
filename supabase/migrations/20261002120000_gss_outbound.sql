-- =============================================================================
-- Via de saída SOTWISE → GSS: fila `gss_outbound` (docs/INTEGRACAO_GSS.md §10).
--
-- Primeiro dado real (2026-10-02): PL/Shipment → `/v1/shipments/` do GSS. Create
-- PL cria o PL lá, e cada data concluída das etapas Loading date, Shipping date,
-- ETA Brazil, ATA Brazil e Delivered atualiza o registro.
--
-- Por que trigger e não código: as datas do checklist do PL são gravadas em
-- vários lugares (savePreLoadingStep, saveShipmentStep, a RPC confirm_shipping,
-- as actions de e-mail da etapa), e `main` e `dev` escrevem no MESMO banco. O
-- trigger pega todos — mesmo argumento de `trg_batches_notify_client`
-- (20260819140000).
--
-- A fila guarda só "o PL X mudou". O payload é montado pelo app na hora do envio
-- a partir do estado atual (lib/gss/outbound/pl-shipment.ts): vários saves
-- seguidos viram UM envio e sempre vai o último valor. O Postgres nunca fala com
-- o GSS — quem envia é lib/gss/outbound/dispatch.ts.
--
-- ⚠️ Re-migração/recarga em massa do checklist enfileira todos os PLs tocados.
-- Antes de uma, desligar GSS_OUTBOUND_ENABLED e, depois, descartar os pendentes:
--   update public.gss_outbound set status = 'skipped', last_error = 'recarga'
--   where status = 'pending';
-- =============================================================================

create table public.gss_outbound (
  id              uuid primary key default gen_random_uuid(),
  -- O que mandar e sobre quem. Hoje só 'pl_shipment' (entity_id = pre_loadings.id).
  kind            text not null,
  entity_id       uuid not null,
  status          text not null default 'pending'
                  check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  -- Trava do envio em curso: vencida, a linha volta a ser reivindicável (o
  -- processo que a pegou morreu no meio).
  locked_until    timestamptz,
  -- O que foi enviado ({method, path, body}) e o que o GSS respondeu.
  request         jsonb,
  response_status integer,
  response_body   text,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  sent_at         timestamptz
);

-- Um envio pendente por registro: saves seguidos não empilham.
create unique index uq_gss_outbound_pending
  on public.gss_outbound (kind, entity_id)
  where status = 'pending';

-- O que a reivindicação varre.
create index idx_gss_outbound_due
  on public.gss_outbound (next_attempt_at)
  where status in ('pending', 'sending');

create index idx_gss_outbound_entity on public.gss_outbound (entity_id);

create trigger trg_gss_outbound_updated_at before update on public.gss_outbound
  for each row execute function public.set_updated_at();

-- RLS deny-all, no padrão das demais tabelas: acesso só pelo service_role.
alter table public.gss_outbound enable row level security;

comment on table public.gss_outbound is
  'Fila de envio SOTWISE -> GSS. Escrita por trigger, drenada pelo app (lib/gss/outbound).';

-- ---------- enfileirar ----------
create or replace function public.enqueue_gss_outbound(p_kind text, p_entity_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.gss_outbound (kind, entity_id)
  values (p_kind, p_entity_id)
  on conflict (kind, entity_id) where status = 'pending' do nothing;
$$;

revoke all on function public.enqueue_gss_outbound(text, uuid) from public;
revoke all on function public.enqueue_gss_outbound(text, uuid) from anon;
revoke all on function public.enqueue_gss_outbound(text, uuid) from authenticated;
grant execute on function public.enqueue_gss_outbound(text, uuid) to service_role;

/**
 * Create PL. Linhas com `bubble_id` vêm de migração/recarga do Bubble, não do
 * botão Create PL — essas não viram envio (um PL antigo entra no GSS na
 * primeira data alterada, pelo caminho "não existe lá → cria").
 *
 * Falha da fila NUNCA derruba a gravação do usuário: vira warning no log.
 */
create or replace function public.gss_outbound_on_pre_loading_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.bubble_id is not null then
    return null;
  end if;
  begin
    perform public.enqueue_gss_outbound('pl_shipment', new.id);
  exception when others then
    raise warning 'gss_outbound: enqueue falhou para PL %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger trg_pre_loadings_gss_outbound
  after insert on public.pre_loadings
  for each row execute function public.gss_outbound_on_pre_loading_insert();

/** Data concluída de uma das 5 etapas enviadas ao GSS mudou. */
create or replace function public.gss_outbound_on_pl_step_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.enqueue_gss_outbound('pl_shipment', new.pre_loading_id);
  exception when others then
    raise warning 'gss_outbound: enqueue falhou para PL %: %', new.pre_loading_id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger trg_pl_steps_gss_outbound_update
  after update of completed_on on public.pre_loading_checklist_steps
  for each row
  when (
    new.step in ('loading_date', 'shipping_date', 'eta_brazil', 'ata_brazil', 'delivered')
    and new.completed_on is distinct from old.completed_on
  )
  execute function public.gss_outbound_on_pl_step_change();

-- Linha de etapa criada já concluída (ensureStepId + save, ou insert direto).
create trigger trg_pl_steps_gss_outbound_insert
  after insert on public.pre_loading_checklist_steps
  for each row
  when (
    new.step in ('loading_date', 'shipping_date', 'eta_brazil', 'ata_brazil', 'delivered')
    and new.completed_on is not null
  )
  execute function public.gss_outbound_on_pl_step_change();

-- ---------- reivindicar ----------
/**
 * Pega até `p_limit` envios vencidos e os marca `sending` com trava de 5 min.
 * `SKIP LOCKED`: dois disparos ao mesmo tempo (after() de duas actions, cron)
 * nunca pegam a mesma linha — ao contrário de client_notifications, aqui um
 * POST/PATCH repetido teria efeito no GSS.
 *
 * Também recupera `sending` com trava vencida (processo morreu no meio).
 */
create or replace function public.claim_gss_outbound(p_limit integer default 25)
returns setof public.gss_outbound
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select g.id
    from public.gss_outbound g
    where (g.status = 'pending' and g.next_attempt_at <= now())
       or (g.status = 'sending' and g.locked_until < now())
    order by g.next_attempt_at, g.created_at
    limit greatest(coalesce(p_limit, 25), 1)
    for update skip locked
  )
  update public.gss_outbound g
  set status = 'sending',
      locked_until = now() + interval '5 minutes'
  from picked
  where g.id = picked.id
  returning g.*;
end;
$$;

revoke all on function public.claim_gss_outbound(integer) from public;
revoke all on function public.claim_gss_outbound(integer) from anon;
revoke all on function public.claim_gss_outbound(integer) from authenticated;
grant execute on function public.claim_gss_outbound(integer) to service_role;
