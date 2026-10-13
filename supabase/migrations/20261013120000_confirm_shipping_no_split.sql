-- =============================================================================
-- confirm_shipping_no_split: Confirm Shipping SEM split de lote (13/10/2026).
--
-- O SOT deixa de criar lotes. Quem decide se existe um lote novo é o GSS: ele
-- enxerga o nível PRODUTO (abaixo de Factory × Category, com quantidade) e sabe
-- o que de fato embarcou; quando sobra saldo, o GSS cria o lote seguinte pela
-- API (POST /api/batches). Por isso, no PL -> Shipment:
--   - o loading_status (Total/Partial/None) de cada entrada continua sendo
--     gravado, junto com o snapshot em shipment_loaded_lines;
--   - NENHUMA entrada migra de lote e NENHUM lote é criado — a linha
--     Partial/None fica no lote que embarcou, com o status gravado;
--   - todo lote do PL vai para in_transit.
--
-- Função NOVA (não create or replace da confirm_shipping): main e dev usam o
-- mesmo banco, e a main (produção) segue chamando a confirm_shipping com split
-- até essa regra ser levada pra lá. Mesma assinatura e mesmo retorno.
--
-- delete_shipment segue correto: as linhas não-Total registradas no embarque
-- já estão no lote de origem (o "voltar" delas é no-op).
-- =============================================================================

create or replace function public.confirm_shipping_no_split(
  p_pre_loading_id uuid,
  p_container_number text,
  p_seal_number text,
  p_estimated_date date,
  p_shipment_leader_id uuid,
  p_preloading_leader_id uuid,
  p_carrier_id uuid,
  p_shipment_model_id uuid,
  p_signer_id uuid,
  p_created_by uuid,
  p_statuses jsonb,
  p_loading_date_completed_on date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment_id uuid;
  v_order_ids uuid[];
  v_changed_orders uuid[] := '{}';
  v_order record;
  v_target_status public.order_status;
begin
  -- 1. Shipment (1:1). O unique em pre_loading_id barra confirmação dupla.
  insert into public.shipments (
    pre_loading_id, container_number, carrier_id, shipment_model_id,
    leader_id, signer_id, estimated_date, status, created_by
  ) values (
    p_pre_loading_id, p_container_number, p_carrier_id, p_shipment_model_id,
    p_shipment_leader_id, p_signer_id, p_estimated_date, 'in_transit', p_created_by
  )
  returning id into v_shipment_id;

  -- 2. loading_status por entrada.
  update public.order_factory_category ofc
  set loading_status = (v->>'status')::public.loading_status
  from jsonb_array_elements(p_statuses) as v
  where ofc.id = (v->>'ofc_id')::uuid;

  -- 2b. Snapshot do que ESTE embarque carregou.
  insert into public.shipment_loaded_lines (shipment_id, batch_id, order_factory_category_id, loading_status)
  select v_shipment_id, ofc.batch_id, ofc.id, (v->>'status')::public.loading_status
  from jsonb_array_elements(p_statuses) as v
  join public.order_factory_category ofc on ofc.id = (v->>'ofc_id')::uuid
  where ofc.batch_id is not null;

  -- 3. Os lotes do PL vão para in_transit — sem split.
  update public.batches b
  set status = 'in_transit'
  from public.pre_loading_batches plb
  where plb.batch_id = b.id and plb.pre_loading_id = p_pre_loading_id;

  -- Rollup das Orders donas dos lotes do PL (docs §3.7.1).
  select array_agg(distinct b.order_id) into v_order_ids
  from public.batches b
  join public.pre_loading_batches plb on plb.batch_id = b.id
  where plb.pre_loading_id = p_pre_loading_id;

  if v_order_ids is not null then
    for v_order in
      select o.id, o.status, array_agg(b.status) as batch_statuses
      from public.orders o
      join public.batches b on b.order_id = o.id
      where o.id = any(v_order_ids)
      group by o.id, o.status
    loop
      v_target_status := public.rollup_order_status(v_order.batch_statuses, v_order.status);
      if v_target_status <> v_order.status then
        update public.orders set status = v_target_status where id = v_order.id;
        v_changed_orders := v_changed_orders || v_order.id;
      end if;
    end loop;
  end if;

  -- Completed on da etapa "loading_date" (revisável no popup).
  update public.pre_loading_checklist_steps
  set completed_on = p_loading_date_completed_on
  where pre_loading_id = p_pre_loading_id and step = 'loading_date';

  -- 4. Marca o PL como confirmado + grava seal/leader do embarque.
  update public.pre_loadings
  set seal_number = p_seal_number,
      leader_id = p_preloading_leader_id,
      shipping_confirmed_at = now()
  where id = p_pre_loading_id;

  return jsonb_build_object(
    'shipment_id', v_shipment_id,
    'changed_order_ids', to_jsonb(coalesce(v_changed_orders, '{}'))
  );
end;
$$;

revoke all on function public.confirm_shipping_no_split(
  uuid, text, text, date, uuid, uuid, uuid, uuid, uuid, uuid, jsonb, date
) from public;
revoke all on function public.confirm_shipping_no_split(
  uuid, text, text, date, uuid, uuid, uuid, uuid, uuid, uuid, jsonb, date
) from anon;
revoke all on function public.confirm_shipping_no_split(
  uuid, text, text, date, uuid, uuid, uuid, uuid, uuid, uuid, jsonb, date
) from authenticated;
grant execute on function public.confirm_shipping_no_split(
  uuid, text, text, date, uuid, uuid, uuid, uuid, uuid, uuid, jsonb, date
) to service_role;

comment on function public.confirm_shipping_no_split is
  'Confirm Shipping (PL -> Shipment) sem split de lote — lotes novos só vêm do GSS. Ver domain/shipments/confirm.ts.';

notify pgrst, 'reload schema';
