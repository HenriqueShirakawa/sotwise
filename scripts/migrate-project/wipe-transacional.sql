-- =============================================================================
-- WIPE do transacional (27/10/2026) — zera Order, Lote, Pre-loading, Shipment
-- e tudo que depende deles. Mantém bibliotecas, usuários, papéis e permissões.
--
-- Rodar no SQL Editor do Supabase Studio (usuário `postgres`) do projeto AGK
-- (qqbeoljgpfllhcvqrsup). As tabelas de e-mail bloqueiam DELETE pelo service
-- role (REVOKE), por isso é TRUNCATE como postgres, não pela API.
--
-- Conferido no AGK em 27/10: nenhuma tabela de biblioteca/usuário referencia
-- estas, então o CASCADE não vaza pra fora da lista abaixo.
-- Plano: docs/PLANO_VIRADA_SOT_VISTA.md
-- =============================================================================

begin;

truncate table
  -- e-mails das etapas (o ciclo email_threads ↔ checklist_step_emails some no truncate)
  email_threads,
  checklist_step_email_threads,
  checklist_step_email_reply_recipients,
  checklist_step_email_replies,
  email_delivery_events,
  checklist_step_emails,
  -- log, revisões e anexos das etapas
  checklist_step_log,
  checklist_step_revisions,
  step_attachments,
  -- shipment e pre-loading
  shipment_loaded_lines,
  shipments,
  pre_loading_client_bookings,
  pre_loading_client_original_docs,
  pre_loading_client_delivered,
  pre_loading_batches,
  pre_loading_clients,
  pre_loading_checklist_steps,
  pre_loadings,
  -- order e lote
  client_notifications,
  etd_history,
  etd_info,
  order_factory_placed_dates,
  order_factory_category,
  order_checklist_steps,
  batches,
  orders,
  -- mensagens (ficam penduradas em order/PL/shipment, sem FK)
  message_recipients,
  messages
cascade;

-- Tabelas sem FK que guardam referência a esses registros (podem não existir).
do $$
begin
  if to_regclass('public.gss_outbound') is not null then
    execute 'truncate table public.gss_outbound';
  end if;
  if to_regclass('public.gss_sync_log') is not null then
    execute 'truncate table public.gss_sync_log';
  end if;
end $$;

delete from activity_logs
where entity_type in ('order', 'batch', 'pre_loading', 'shipment');

-- Conferência: tudo tem que dar 0.
select 'orders' as tabela, count(*) from orders
union all select 'batches', count(*) from batches
union all select 'order_factory_category', count(*) from order_factory_category
union all select 'pre_loadings', count(*) from pre_loadings
union all select 'shipments', count(*) from shipments
union all select 'order_checklist_steps', count(*) from order_checklist_steps
union all select 'pre_loading_checklist_steps', count(*) from pre_loading_checklist_steps
union all select 'checklist_step_emails', count(*) from checklist_step_emails;

commit;
