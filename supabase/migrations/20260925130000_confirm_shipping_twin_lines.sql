-- =============================================================================
-- confirm_shipping: linha Partial/None NÃO duplica quando o lote seguinte já
-- tem a mesma Factory × Category (QA 25/09, pedidos 1665 e 1668).
--
-- Cenário: lotes espelhados — o .01 e o .02 do pedido têm as mesmas entradas
-- (ex.: Aok × Absorber em cada um, com Ship req. diferentes). Embarcar o .01
-- com Aok × Absorber = Partial movia a linha do .01 pro .02, que já tinha a
-- dele — o .02 ficava com Aok × Absorber duas vezes, e o PL/embarque seguinte
-- carregava a duplicata adiante.
--
-- Regra nova: a linha Partial/None só migra se o lote de destino ainda NÃO
-- tem uma entrada com a mesma Category + Factory. Se tem, a do destino já é a
-- continuação do saldo; a de origem fica no lote que embarcou, com o
-- Partial/None gravado (é o estado dela: vive num lote embarcado, igual às
-- Total). Lote criado na hora pelo split não tem gêmea — tudo migra como antes.
-- A linhagem (split_from_batch_id) só é anotada no destino quando alguma
-- linha realmente migrou.
--
-- delete_shipment segue correto: a linha que ficou já está no lote de origem
-- (o "voltar" dela é no-op) e o loading_status do lote de origem é zerado lá.
--
-- Mesma assinatura da 20260917130000 — create or replace basta.
-- =============================================================================

create or replace function public.confirm_shipping(
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
  -- Completed on da etapa "loading_date" — o popup passou a poder revisar
  -- essa data (antes só exibia); a etapa já precisa estar completa pra
  -- confirmShipping ter liberado o botão, então isto é sempre not-null.
  p_loading_date_completed_on date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment_id uuid;
  v_batch record;
  v_to_move uuid[];
  v_target record;
  v_target_id uuid;
  v_next_num int;
  v_order_ids uuid[];
  v_changed_orders uuid[] := '{}';
  v_order record;
  v_target_status public.order_status;
begin
  -- 1. Shipment (1:1). O unique em pre_loading_id barra confirmação dupla —
  -- mesma trava de antes, agora dentro da mesma transação do resto.
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

  -- 2b. Snapshot do que ESTE embarque carregou (lote de ORIGEM — lido antes do
  -- split abaixo mover order_factory_category.batch_id).
  insert into public.shipment_loaded_lines (shipment_id, batch_id, order_factory_category_id, loading_status)
  select v_shipment_id, ofc.batch_id, ofc.id, (v->>'status')::public.loading_status
  from jsonb_array_elements(p_statuses) as v
  join public.order_factory_category ofc on ofc.id = (v->>'ofc_id')::uuid
  where ofc.batch_id is not null;

  -- 3+4. Split: por lote de origem do PL. Uma linha inserida por uma iteração
  -- anterior deste mesmo loop já é visível às consultas seguintes (mesma
  -- transação) — dispensa o cache manual que a versão em TS precisava manter.
  for v_batch in
    select b.id, b.order_id, b.batch_number
    from public.batches b
    join public.pre_loading_batches plb on plb.batch_id = b.id
    where plb.pre_loading_id = p_pre_loading_id
  loop
    select array_agg(ofc.id) into v_to_move
    from jsonb_array_elements(p_statuses) as v
    join public.order_factory_category ofc on ofc.id = (v->>'ofc_id')::uuid
    where ofc.batch_id = v_batch.id and (v->>'status') <> 'total';

    if v_to_move is not null and array_length(v_to_move, 1) > 0 then
      -- Próximo lote do pedido já aberto (fora deste PL, número maior que o
      -- de origem). Só cria um lote novo quando não existe nenhum.
      select b2.id, b2.split_from_batch_id into v_target
      from public.batches b2
      where b2.order_id = v_batch.order_id
        and b2.status in ('in_negotiation', 'in_production')
        and not exists (
          select 1 from public.pre_loading_batches plb2
          where plb2.pre_loading_id = p_pre_loading_id and plb2.batch_id = b2.id
        )
        and public.batch_seq_number(b2.batch_number) > public.batch_seq_number(v_batch.batch_number)
      order by public.batch_seq_number(b2.batch_number) asc
      limit 1;

      if v_target.id is not null then
        v_target_id := v_target.id;

        -- Linha cuja gêmea (mesma Category + Factory) já está no destino não
        -- migra: fica no lote embarcado com o Partial/None do passo 2.
        select array_agg(src.id) into v_to_move
        from public.order_factory_category src
        where src.id = any(v_to_move)
          and not exists (
            select 1 from public.order_factory_category twin
            where twin.batch_id = v_target_id
              and twin.category_id = src.category_id
              and twin.factory_id = src.factory_id
          );

        -- Só grava a linhagem quando alguma linha migrou e o destino ainda não
        -- tinha uma (a origem já registrada de um lote não se sobrescreve).
        if v_to_move is not null and v_target.split_from_batch_id is null then
          update public.batches set split_from_batch_id = v_batch.id where id = v_target_id;
        end if;
      else
        select coalesce(max(public.batch_seq_number(b3.batch_number)), 0) + 1 into v_next_num
        from public.batches b3
        where b3.order_id = v_batch.order_id;

        insert into public.batches (order_id, batch_number, status, split_from_batch_id)
        values (v_batch.order_id, '.' || lpad(v_next_num::text, 2, '0'), 'in_production', v_batch.id)
        returning id into v_target_id;
      end if;

      -- O None/Partial gravado no passo 2 pertence ao embarque que acabou de
      -- sair; o lote de destino ainda não passou por PL->Shipment.
      if v_to_move is not null then
        update public.order_factory_category
        set batch_id = v_target_id, loading_status = null
        where id = any(v_to_move);
      end if;
    end if;

    -- O lote que carregou vai para in_transit.
    update public.batches set status = 'in_transit' where id = v_batch.id;
  end loop;

  -- Rollup das Orders donas dos lotes originais do PL (docs §3.7.1).
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

  -- Completed on da etapa "loading_date": o popup passou a permitir revisar
  -- essa data no momento da confirmação, em vez de só exibi-la.
  update public.pre_loading_checklist_steps
  set completed_on = p_loading_date_completed_on
  where pre_loading_id = p_pre_loading_id and step = 'loading_date';

  -- 5. Marca o PL como confirmado + grava seal/leader do embarque.
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

revoke all on function public.confirm_shipping(
  uuid, text, text, date, uuid, uuid, uuid, uuid, uuid, uuid, jsonb, date
) from public;
revoke all on function public.confirm_shipping(
  uuid, text, text, date, uuid, uuid, uuid, uuid, uuid, uuid, jsonb, date
) from anon;
revoke all on function public.confirm_shipping(
  uuid, text, text, date, uuid, uuid, uuid, uuid, uuid, uuid, jsonb, date
) from authenticated;
grant execute on function public.confirm_shipping(
  uuid, text, text, date, uuid, uuid, uuid, uuid, uuid, uuid, jsonb, date
) to service_role;

comment on function public.confirm_shipping is
  'Confirm Shipping (PL -> Shipment), atômico. Ver app/(dashboard)/pre-loading/[id]/actions.ts:confirmShipping — só chama depois de validar checklist/campos.';
