-- Lista de ETD Factories paginada no servidor (2026-10-29).
--
-- Uma linha por Factory x Category ATIVA de lote em produção ou pre-loading
-- (docs/regras_de_negocio.md §3.7.4) de order viva — o mesmo recorte da página
-- antiga, que baixava todas essas linhas e paginava/filtrava no navegador.
--
-- Colunas só de ordenação/filtro (a tela exibe pelos helpers de lib/etd):
--  - days_delay = |current_date − initial_date| em dias (lib/etd daysDelay);
--  - gap_of_ready = hoje − ready_date, só com `ready` (lib/etd gapOfReady);
--  - batch_seq = parte numérica do lote (".10" depois de ".9");
--  - batch_status_label = rótulo exibido (a lista ordena pelo rótulo);
--  - last_updated_day = dia (UTC) do updated_at do ETD.
--
-- security_invoker + sem grant para anon/authenticated: só o service role lê.

create or replace view public.etd_list
with (security_invoker = true) as
select
  ofc.id,
  ofc.order_id,
  c.name as client,
  o.client_id,
  o.po_number,
  case when btrim(o.po_number) ~ '^\d+$' then btrim(o.po_number)::bigint else 0 end as po_number_int,
  b.batch_number,
  coalesce(substring(b.batch_number from '\d+')::int, 0) as batch_seq,
  coalesce(f.name, '—') as factory,
  ofc.factory_id,
  coalesce(cat.name, '—') as category,
  ofc.category_id,
  o.date_po as order_date,
  ofc.ship_requirement as shipment_req,
  ei.initial_date,
  ei."current_date",
  abs(ei."current_date" - ei.initial_date) as days_delay,
  ei.updated_at as last_updated,
  (ei.updated_at at time zone 'UTC')::date as last_updated_day,
  b.status as batch_status,
  case b.status
    when 'in_negotiation' then 'In Negotiation'
    when 'in_production' then 'In Production'
    when 'preloading' then 'Pre-Loading'
    when 'in_transit' then 'In Transit'
    when 'delivered' then 'Delivered'
    when 'canceled' then 'Canceled'
  end as batch_status_label,
  coalesce(ei.ready, false) as ready_parts,
  ei.ready_date,
  case
    when ei.ready and ei.ready_date is not null
      then round(extract(epoch from (now() - (ei.ready_date::timestamp at time zone 'UTC'))) / 86400)::int
  end as gap_of_ready,
  coalesce(ei.inspection, false) as inspection,
  dl.name as dispatch_location,
  ei.dispatch_date
from public.order_factory_category ofc
join public.batches b on b.id = ofc.batch_id
join public.orders o on o.id = ofc.order_id and o.deleted_at is null
left join public.etd_info ei on ei.order_factory_category_id = ofc.id
left join public.clients c on c.id = o.client_id and c.deleted_at is null
left join public.factories f on f.id = ofc.factory_id and f.deleted_at is null
left join public.categories cat on cat.id = ofc.category_id and cat.deleted_at is null
left join public.factories dl on dl.id = ei.dispatch_location_id and dl.deleted_at is null
where ofc.is_active
  and b.status in ('in_production', 'preloading');

revoke all on public.etd_list from public, anon, authenticated;
grant select on public.etd_list to service_role;
