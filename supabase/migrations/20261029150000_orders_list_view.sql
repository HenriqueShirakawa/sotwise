-- Lista de Orders paginada no servidor (2026-10-29).
--
-- A tela /orders baixava orders, lotes e ETDs inteiros e paginava/filtrava/
-- ordenava no navegador. Esta view entrega uma linha por order da lista, já com
-- nomes, lotes e ETD (mesmas regras da página antiga); a página lê só a página
-- pedida, com busca/filtros/ordenação da URL.
--
-- Regras mantidas:
--  - só entra order viva com po_number puramente numérico (as ~80 "fantasmas"
--    do Bubble têm o unique id no lugar do número);
--  - ETD da order = menor "Initial date" entre as Factory x Category ativas dela
--    (docs/regras_de_negocio.md §3.7.4);
--  - Exporter exibido = sigla, senão o nome.
--
-- security_invoker + sem grant para anon/authenticated: só o service role lê.

create or replace view public.orders_list
with (security_invoker = true) as
with
batches as (
  select
    b.order_id,
    jsonb_agg(jsonb_build_object('batch_number', b.batch_number, 'status', b.status)
              order by b.batch_number) as batches
  from public.batches b
  group by b.order_id
),
etd as (
  select ofc.order_id, min(ei.initial_date) as etd
  from public.order_factory_category ofc
  join public.etd_info ei on ei.order_factory_category_id = ofc.id
  where ofc.is_active and ei.initial_date is not null
  group by ofc.order_id
)
select
  o.id,
  o.po_number,
  btrim(o.po_number)::bigint as po_number_int,
  bu.name as bu,
  ot.name as type,
  ot.color as type_color,
  c.name as client,
  o.client_reference,
  coalesce(bt.batches, '[]'::jsonb) as batches,
  leader.full_name as leader,
  op.full_name as operational_responsible,
  req.full_name as requester,
  coalesce(nullif(e.acronym, ''), e.name) as exporter,
  o.created_at as date_create,
  -- dia (UTC) da criação: o filtro de "Create Date" compara por dia
  (o.created_at at time zone 'UTC')::date as date_create_day,
  o.status,
  -- ordenar Status por texto (como a lista antiga), não pela ordem do enum
  o.status::text as status_text,
  o.schedule_requested,
  etd.etd,
  o.order_type_id,
  o.client_id,
  o.business_unit_id,
  o.requester_id,
  o.exporter_id,
  o.leader_id,
  o.operational_responsible_id
from public.orders o
left join public.business_units bu on bu.id = o.business_unit_id and bu.deleted_at is null
left join public.order_types ot on ot.id = o.order_type_id and ot.deleted_at is null
left join public.clients c on c.id = o.client_id and c.deleted_at is null
left join public.exporters e on e.id = o.exporter_id and e.deleted_at is null
left join public.profiles leader on leader.id = o.leader_id
left join public.profiles op on op.id = o.operational_responsible_id
left join public.profiles req on req.id = o.requester_id
left join batches bt on bt.order_id = o.id
left join etd on etd.order_id = o.id
where o.deleted_at is null
  and btrim(o.po_number) ~ '^\d+$';

revoke all on public.orders_list from public, anon, authenticated;
grant select on public.orders_list to service_role;
