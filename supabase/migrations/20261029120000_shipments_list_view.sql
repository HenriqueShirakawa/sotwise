-- Lista de Shipments paginada no servidor (2026-10-29).
--
-- A tela /shipments baixava as tabelas inteiras (shipments, PLs, lotes, orders,
-- Factory x Category, etapas do checklist…) e paginava/filtrava/ordenava no
-- navegador. Com o histórico do Bubble na produção isso virou ~44 mil linhas por
-- abertura, em dezenas de idas e voltas São Paulo↔Oregon.
--
-- Esta view entrega UMA linha por shipment vivo, já com as colunas e os campos de
-- filtro da lista (mesmas regras da página antiga). A página lê só a página pedida
-- (`range` + `count`), com filtros e ordenação aplicados aqui no banco.
--
-- Datas das etapas: event_date (data do fato, 21/10/2026) → completed_on →
-- estimated_date, igual ao `stepDate` da página.
--
-- security_invoker + sem grant para anon/authenticated: só o service role (a
-- página é server-side) lê.

create or replace view public.shipments_list
with (security_invoker = true) as
with
steps as (
  select
    s.pre_loading_id,
    (array_agg(s.pol_id) filter (where s.step = 'port_of_loading'))[1] as pol_id,
    (array_agg(s.consolidation_point_id) filter (where s.step = 'consolidation_point'))[1] as consolidation_point_id,
    (array_agg(s.agent_brazil_id) filter (where s.step = 'agents'))[1] as agent_brazil_id,
    (array_agg(s.agent_china_id) filter (where s.step = 'agents'))[1] as agent_china_id,
    (array_agg(coalesce(s.event_date, s.completed_on, s.estimated_date)) filter (where s.step = 'loading_date'))[1] as loading_date,
    (array_agg(coalesce(s.event_date, s.completed_on, s.estimated_date)) filter (where s.step = 'shipping_date'))[1] as ship_date,
    (array_agg(coalesce(s.event_date, s.completed_on, s.estimated_date)) filter (where s.step = 'eta_brazil'))[1] as eta,
    (array_agg(coalesce(s.event_date, s.completed_on, s.estimated_date)) filter (where s.step = 'bl'))[1] as bl_date,
    (array_agg(coalesce(s.event_date, s.completed_on, s.estimated_date)) filter (where s.step = 'ata_brazil'))[1] as ata_date,
    (array_agg(coalesce(s.event_date, s.completed_on, s.estimated_date)) filter (where s.step = 'delivered'))[1] as delivered_date
  from public.pre_loading_checklist_steps s
  where s.step in ('consolidation_point', 'port_of_loading', 'agents', 'loading_date',
                   'shipping_date', 'bl', 'eta_brazil', 'ata_brazil', 'delivered')
  group by s.pre_loading_id
),
clients as (
  select
    pc.pre_loading_id,
    array_agg(distinct pc.client_id) as client_ids,
    string_agg(distinct c.name, ', ' order by c.name) as client
  from public.pre_loading_clients pc
  left join public.clients c on c.id = pc.client_id and c.deleted_at is null
  group by pc.pre_loading_id
),
-- Factory x Category de cada Order SÓ nos lotes deste PL (mesmo escopo do
-- "View parts" e da tabela de lotes do PL).
pl_orders as (
  select pb.pre_loading_id, b.order_id, coalesce(sum(oc.n), 0)::int as ofc_count
  from public.pre_loading_batches pb
  join public.batches b on b.id = pb.batch_id
  left join (
    select batch_id, count(*) as n
    from public.order_factory_category
    where is_active and batch_id is not null
    group by batch_id
  ) oc on oc.batch_id = b.id
  group by pb.pre_loading_id, b.order_id
),
orders as (
  select
    po.pre_loading_id,
    array_agg(po.order_id) as order_ids,
    array_agg(distinct o.order_type_id) filter (where o.order_type_id is not null) as order_type_ids,
    string_agg(distinct ot.name, ', ' order by ot.name) as order_type,
    count(*)::int as sum_of_orders,
    jsonb_agg(
      jsonb_build_object(
        'po_number', case when o.deleted_at is null then o.po_number else '—' end,
        'ofc_count', po.ofc_count
      )
      order by case when o.po_number ~ '^\d+$' then o.po_number::bigint else 0 end
    ) as orders_summary
  from pl_orders po
  join public.orders o on o.id = po.order_id
  left join public.order_types ot on ot.id = o.order_type_id and ot.deleted_at is null
  group by po.pre_loading_id
)
select
  sh.id,
  sh.pre_loading_id,
  pl.pl_number,
  case when pl.pl_number ~ '^\d+$' then pl.pl_number::bigint else 0 end as pl_number_int,
  cl.client,
  coalesce(cl.client_ids, '{}') as client_ids,
  pl.client_reference,
  ord.order_type,
  coalesce(ord.order_type_ids, '{}') as order_type_ids,
  coalesce(ord.order_ids, '{}') as order_ids,
  pl.leader_id,
  pol.name as pol,
  st.pol_id,
  pl.pod_id,
  st.consolidation_point_id,
  st.agent_brazil_id,
  st.agent_china_id,
  sh.carrier_id,
  sh.container_number,
  sm.name as ship_model,
  sh.shipment_model_id,
  st.loading_date,
  st.ship_date,
  st.eta,
  st.bl_date,
  st.ata_date,
  st.delivered_date,
  coalesce(ord.sum_of_orders, 0) as sum_of_orders,
  coalesce(ord.orders_summary, '[]'::jsonb) as orders_summary,
  sh.status
from public.shipments sh
join public.pre_loadings pl on pl.id = sh.pre_loading_id
left join steps st on st.pre_loading_id = sh.pre_loading_id
left join clients cl on cl.pre_loading_id = sh.pre_loading_id
left join orders ord on ord.pre_loading_id = sh.pre_loading_id
left join public.pols pol on pol.id = st.pol_id and pol.deleted_at is null
left join public.shipment_models sm on sm.id = sh.shipment_model_id and sm.deleted_at is null
where sh.deleted_at is null;

revoke all on public.shipments_list from public, anon, authenticated;
grant select on public.shipments_list to service_role;
