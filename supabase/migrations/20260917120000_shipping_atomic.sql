-- =============================================================================
-- confirmShipping / deleteShipment viram RPC atômica.
--
-- Motivo: as duas Server Actions faziam uma sequência de escritas separadas
-- (shipment -> loading_status -> snapshot -> split -> confirma o PL / desfaz
-- tudo isso), sem transação — o cliente do Supabase via PostgREST não expõe
-- uma. Uma falha no meio (era a migration desta tabela faltando; poderia ser
-- qualquer outra coisa no futuro) deixava o shipment criado mas o split/PL
-- pela metade — precisou de limpeza manual em produção em 17/09/2026 (PLs
-- 1302, 1451, 1452, 1453). Ver docs/regras_de_negocio.md §3.9.6/§3.7.2.
--
-- Cada função abaixo roda como uma única chamada RPC = uma única transação:
-- qualquer erro no meio desfaz tudo, sem deixar órfão. A validação de
-- formulário/checklist (mensagens de erro amigáveis) continua nas Server
-- Actions, que só chamam a RPC depois de confirmar que os dados são válidos.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- ".03" -> 3. Sufixo não numérico conta como 0 (dado migrado do Bubble) —
-- mesma regra de app/(dashboard)/pre-loading/[id]/actions.ts:batchNum.
create or replace function public.batch_seq_number(p_batch_number text)
returns int
language sql
immutable
as $$
  select coalesce((regexp_match(p_batch_number, '^\.?(\d+)$'))[1]::int, 0)
$$;

revoke all on function public.batch_seq_number(text) from public;
revoke all on function public.batch_seq_number(text) from anon;
revoke all on function public.batch_seq_number(text) from authenticated;
grant execute on function public.batch_seq_number(text) to service_role;

-- Status da Order = rollup dos lotes — mesma regra de lib/order-status.ts:
-- rollupOrderStatus (docs §3.7.1). Mantidas as duas em sincronia se a regra
-- mudar: nenhuma outra rota escreve orders.status fora desta função.
create or replace function public.rollup_order_status(
  p_batch_statuses public.batch_status[],
  p_current_status public.order_status
) returns public.order_status
language plpgsql
immutable
as $$
declare
  v_active public.batch_status[];
begin
  if p_current_status = 'canceled' then
    return 'canceled';
  end if;

  select array_agg(s) into v_active from unnest(p_batch_statuses) as s where s <> 'canceled';
  if v_active is null or array_length(v_active, 1) = 0 then
    return p_current_status;
  end if;

  if v_active <@ array['delivered']::public.batch_status[] then return 'delivered'; end if;
  if 'delivered' = any(v_active) then return 'partially_delivered'; end if;
  if v_active <@ array['in_transit']::public.batch_status[] then return 'shipped'; end if;
  if 'in_transit' = any(v_active) then return 'partially_shipped'; end if;
  if v_active <@ array['preloading']::public.batch_status[] then return 'pre_loading'; end if;
  if 'preloading' = any(v_active) then return 'partially_preloading'; end if;
  if 'in_production' = any(v_active) then return 'in_production'; end if;
  return 'in_negotiation';
end;
$$;

revoke all on function public.rollup_order_status(public.batch_status[], public.order_status) from public;
revoke all on function public.rollup_order_status(public.batch_status[], public.order_status) from anon;
revoke all on function public.rollup_order_status(public.batch_status[], public.order_status) from authenticated;
grant execute on function public.rollup_order_status(public.batch_status[], public.order_status) to service_role;

-- ---------------------------------------------------------------------------
-- confirm_shipping: porta app/(dashboard)/pre-loading/[id]/actions.ts:confirmShipping
-- passos 1–5 (tudo que ESCREVE). A validação de checklist/campos obrigatórios
-- continua na Server Action, antes de chamar esta função.
-- ---------------------------------------------------------------------------
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
  -- [{ "ofc_id": uuid, "status": "none"|"partial"|"total" }, ...] — uma por
  -- order_factory_category do(s) lote(s) do PL; a Server Action já validou a
  -- cobertura completa antes de chamar.
  p_statuses jsonb
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
        -- Só grava a linhagem quando o destino ainda não tinha uma (a origem
        -- já registrada de um lote não se sobrescreve).
        if v_target.split_from_batch_id is null then
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
      update public.order_factory_category
      set batch_id = v_target_id, loading_status = null
      where id = any(v_to_move);
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
  uuid, text, text, date, uuid, uuid, uuid, uuid, uuid, uuid, jsonb
) from public;
revoke all on function public.confirm_shipping(
  uuid, text, text, date, uuid, uuid, uuid, uuid, uuid, uuid, jsonb
) from anon;
revoke all on function public.confirm_shipping(
  uuid, text, text, date, uuid, uuid, uuid, uuid, uuid, uuid, jsonb
) from authenticated;
grant execute on function public.confirm_shipping(
  uuid, text, text, date, uuid, uuid, uuid, uuid, uuid, uuid, jsonb
) to service_role;

comment on function public.confirm_shipping is
  'Confirm Shipping (PL -> Shipment), atômico. Ver app/(dashboard)/pre-loading/[id]/actions.ts:confirmShipping — só chama depois de validar checklist/campos.';

-- ---------------------------------------------------------------------------
-- delete_shipment: porta app/(dashboard)/shipments/[id]/actions.ts:deleteShipment
-- por inteiro (guards + escritas) — as guardas viram exceção, que a Server
-- Action repassa via error.message, igual antes.
-- ---------------------------------------------------------------------------
create or replace function public.delete_shipment(p_shipment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment record;
  v_orig_ids uuid[];
  v_child record;
  v_born_here uuid[] := '{}';
  v_merged uuid[] := '{}';
  v_has_snapshot boolean;
  v_pushed_out uuid[];
  v_order_ids uuid[];
  v_changed_orders uuid[] := '{}';
  v_order record;
  v_target_status public.order_status;
begin
  select id, pre_loading_id, status, created_at
  into v_shipment
  from public.shipments
  where id = p_shipment_id;

  if v_shipment.id is null then
    raise exception 'Shipment not found.';
  end if;
  -- Embarque entregue não se desfaz: a carga chegou, reverter mexeria em
  -- status de lote/Order já encerrados.
  if v_shipment.status = 'delivered' then
    raise exception 'A delivered shipment can''t be deleted.';
  end if;

  select array_agg(batch_id) into v_orig_ids
  from public.pre_loading_batches
  where pre_loading_id = v_shipment.pre_loading_id;

  if v_orig_ids is null or array_length(v_orig_ids, 1) = 0 then
    raise exception 'Shipment has no batches.';
  end if;

  -- Guard: só reverte se cada lote do split continua intacto. bornHere =
  -- nasceu neste split (mais novo que o shipment); merged = já existia e só
  -- recebeu a parte não-Total.
  for v_child in
    select id, status, split_from_batch_id, created_at
    from public.batches
    where split_from_batch_id = any(v_orig_ids)
  loop
    if v_child.created_at >= v_shipment.created_at then
      if v_child.status <> 'in_production' then
        raise exception 'Can''t undo this shipment: a batch created by the split already moved forward.';
      end if;
      v_born_here := v_born_here || v_child.id;
    else
      if v_child.status not in ('in_production', 'in_negotiation') then
        raise exception 'Can''t undo this shipment: the batch that received the split already moved forward.';
      end if;
      v_merged := v_merged || v_child.id;
    end if;
  end loop;

  if array_length(v_born_here, 1) > 0 or array_length(v_merged, 1) > 0 then
    if exists (
      select 1 from public.pre_loading_batches
      where batch_id = any(v_born_here || v_merged)
    ) then
      raise exception 'Can''t undo this shipment: a split batch is already in another Pre-loading.';
    end if;
    if exists (
      select 1 from public.batches
      where split_from_batch_id = any(v_born_here || v_merged)
    ) then
      raise exception 'Can''t undo this shipment: a split batch was split again.';
    end if;
  end if;

  -- Desfaz o split: cada linha Factory×Category volta ao lote de origem, e os
  -- lotes que nasceram no split somem.
  if array_length(v_born_here, 1) > 0 then
    update public.order_factory_category ofc
    set batch_id = b.split_from_batch_id
    from public.batches b
    where b.id = any(v_born_here) and ofc.batch_id = b.id;

    delete from public.batches where id = any(v_born_here);
  end if;

  -- No lote que já existia, voltam só as linhas que ESTE embarque empurrou pra
  -- lá — o snapshot é a fonte; sem ele (embarque confirmado antes desta
  -- tabela existir), cai no loading_status como antes.
  select count(*) > 0 into v_has_snapshot
  from public.shipment_loaded_lines where shipment_id = p_shipment_id;

  select array_agg(order_factory_category_id) into v_pushed_out
  from public.shipment_loaded_lines
  where shipment_id = p_shipment_id and loading_status <> 'total';

  if array_length(v_merged, 1) > 0 then
    for v_child in select id, split_from_batch_id from public.batches where id = any(v_merged)
    loop
      if v_has_snapshot then
        update public.order_factory_category
        set batch_id = v_child.split_from_batch_id
        where batch_id = v_child.id and id = any(coalesce(v_pushed_out, '{}'));
      else
        update public.order_factory_category
        set batch_id = v_child.split_from_batch_id
        where batch_id = v_child.id and loading_status in ('none', 'partial');
      end if;

      -- A linhagem foi anotada por este embarque; sem ele, o lote volta a não
      -- ter origem registrada.
      update public.batches set split_from_batch_id = null where id = v_child.id;
    end loop;
  end if;

  -- O loading_status era do embarque desfeito.
  update public.order_factory_category set loading_status = null where batch_id = any(v_orig_ids);

  -- Os lotes voltam para a fase de Pre-loading (revertem de in_transit ou delivered).
  update public.batches set status = 'preloading' where id = any(v_orig_ids);

  -- Apagar o Shipment também apaga o snapshot em shipment_loaded_lines (cascade).
  delete from public.shipments where id = p_shipment_id;

  -- Reabre o PL: sem shipping_confirmed_at ele volta à lista de Pre-loading.
  update public.pre_loadings set shipping_confirmed_at = null where id = v_shipment.pre_loading_id;

  -- Rollup: as Orders voltam de Shipped/Partially Shipped para pre_loading/partially.
  select array_agg(distinct order_id) into v_order_ids
  from public.batches where id = any(v_orig_ids);

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

  return jsonb_build_object(
    'pre_loading_id', v_shipment.pre_loading_id,
    'changed_order_ids', to_jsonb(coalesce(v_changed_orders, '{}'))
  );
end;
$$;

revoke all on function public.delete_shipment(uuid) from public;
revoke all on function public.delete_shipment(uuid) from anon;
revoke all on function public.delete_shipment(uuid) from authenticated;
grant execute on function public.delete_shipment(uuid) to service_role;

comment on function public.delete_shipment is
  'Delete shipment (desfaz Confirm Shipping), atômico. Ver app/(dashboard)/shipments/[id]/actions.ts:deleteShipment — a Server Action só faz requireFeature antes de chamar.';
